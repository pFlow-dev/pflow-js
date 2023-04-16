/*
 MIT License

 Copyright (c) 2023 stackdump.com LLC

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
*/

/**
 * PFlowModel types of models supported by pflow
 * @type {{stateMachine: string, workflow: string, petriNet: string}}
 */
const PFlowModel = {
    petriNet: 'petriNet',
    workflow: 'workflow',
    stateMachine: 'stateMachine'
};

/**
 * PFlowStream manages the state of a collection of models.
 * @type {PFlowStream}
 */
class PFlowStream {

    constructor(models) {
        this.state = new Map();
        this.models = new Map();
        this.schema = undefined;
        this.canvas = undefined;
        this.seq = 0;
        this.history = [];
        models.forEach(model => {
            this.models.set(model.def.schema, model);
        });
        const eventHandlers = new Map();
        this.dispatcher = {
            getHandler: action => eventHandlers.get(action),
            on: (action, handler) => eventHandlers.set(action, handler),
            off: action => eventHandlers.delete(action),
            onFail: handler => eventHandlers.set("__onFail__", handler),
            fail: (s, evt) => eventHandlers.get("__onFail__")(s, evt),
            onEvery: handler => eventHandlers.set("__onEvery__", handler),
            update: model => {
                this.models.set(model.def.schema, model);
            },
            reload: schema => {
                eventHandlers.get("__onReload__")(this, { action: 'reload', schema });
            }
        };
        this.dispatch = this.dispatch.bind(this);
    }

    dispatch(evt) {
        const model = this.models.get(evt.schema);
        if (!model) {
            throw new Error(`model not found: ${evt.schema}`);
        }
        const state = this.state.get(evt.schema) || model.initialVector();

        return model.fire({ state, action: evt.action, multiple: evt.multiple }, ({ out, role }) => {
            this.state.set(evt.schema, out);
            this.history.push({ seq: this.seq++, event: evt, state: out, ts: Date.now() });
            const res = {
                role,
                action: evt.action,
                multiple: evt.multiple,
                state: out
            };
            const onEvery = this.dispatcher.getHandler('__onEvery__');
            if (onEvery) {
                onEvery(this, res);
            }
            const callback = this.dispatcher.getHandler(evt.action);
            if (callback) {
                callback(this, res);
            }
            this.dispatcher.reload(evt.schema);
        }, ({ out, role }) => {
            const res = { state: out, action: evt.action, multiple: evt.multiple, role };
            this.dispatcher.fail(this, res);
        });
    }

    restart() {
        this.seq = 0;
        this.history = [];
        this.models.forEach(model => {
            this.state.delete(model.def.schema);
        });
    }
}

/**
 * pflowStream is a factory function that creates a stream object
 * streams are used to manage the state of a collection of models.
 * @param models
 * @returns PFlowStream
 */
function pflowStream({ models }) {
    return new PFlowStream(models);
}

/**
 * pflowModel is a factory function that creates a model object
 * that can be used to simulate a petriNet, workflow, or state machine.
 * @param schema
 * @param declaration
 * @param type
 * @returns metamodel
 */
function pflowModel({ schema, declaration, type }) {

    const def = {
        schema,
        roles: {},
        places: {},
        transitions: {},
        arcs: [],
        boundSelect: [], // for group select/drag feature
        mode: 'default', // application mode, editing,running, etc..
        type: type || PFlowModel.petriNet
    };

    function assert(flag, msg) {
        if (!flag) {
            throw new Error(msg);
        }
    }

    function fn(label, role, position) {
        const transition = { label, role, position, guards: {}, delta: {} };
        def.transitions[label] = transition;
        // REVIEW: should we support transaction types? i.e. and / or for inputs?
        return {
            transition: transition,
            tx: (weight, target) => {
                assert(target, "target is null");
                assert(target.place, "target node must be a place");
                def.arcs.push({
                    source: { transition: transition },
                    target,
                    weight,
                    inhibit: false
                });
            }
        };
    }

    function cell(label, initial, capacity, position) {
        const place = {
            label: label,
            initial: initial || 0,
            capacity: capacity || 0,
            position: position || {},
            offset: Object.keys(def.places).length
        };
        def.places[label] = place;

        function tx(weight, target) {
            def.arcs.push({
                source: { place: place },
                target: target,
                weight: weight || 1,
                inhibit: false
            });
            assert(target.transition, "target node must be a transition");
        }

        function guard(weight, target) {
            def.arcs.push({
                source: { place },
                target: target,
                weight: weight,
                inhibit: true
            });
            assert(target.transition, "target node must be a transition");
        }

        return { place, tx, guard };
    }

    function role(label) {
        if (!def.roles[label]) {
            def.roles[label] = { label };
        }
        return def.roles[label];
    }

    function emptyVector() {
        const v = [];
        for (const p of Object.keys(def.places)) {
            v.push(0);
        }
        return v;
    }

    function initialVector() {
        const v = emptyVector();
        for (const p of Object.values(def.places)) {
            v[p.offset || 0] = p.initial;
        }
        return v;
    }

    function capacityVector() {
        const v = [];
        for (const p of Object.values(def.places)) {
            v[p.offset] = p.capacity || 0;
        }
        return v;
    }

    function index() {
        for (const transition of Object.values(def.transitions)) {
            transition.delta = emptyVector(); // right size all deltas
        }
        let ok = true;
        for (const arc of Object.values(def.arcs)) {
            if (arc.inhibit) {
                const g = {
                    label: arc.source.place.label,
                    delta: emptyVector()
                };
                g.delta[arc.source.place.offset] = 0 - arc.weight;
                arc.target.transition.guards[arc.source.place.label] = g;
            } else if (arc.source.transition) {
                arc.source.transition.delta[arc.target.place.offset] = arc.weight;
            } else if (arc.source.place) {
                arc.target.transition.delta[arc.source.place.offset] = 0 - arc.weight;
            } else {
                ok = false;
            }
        }
        return ok;
    }

    function vectorAdd(state, delta, multiple) {
        const cap = capacityVector();
        const out = [];
        let ok = true;
        for (const i in state) {
            out[i] = state[i] + delta[i] * multiple;
            if (out[i] < 0) {
                ok = false; // underflow: contains negative
            } else if (cap[i] > 0 && cap[i] - out[i] < 0) {
                ok = false; // overflow: exceeds capacity
            }
        }
        return { out, ok };
    }

    function guardFails(testGuardArgs) {
        const { state, action, multiple } = testGuardArgs;
        assert(action, "action is nil");
        const t = def.transitions[action];
        assert(t, "action not found: " + action);

        if (!t.guards) {
            return { ok: false };
        }
        for (const guard of Object.values(t.guards)) {
            const res = vectorAdd(state, guard.delta, multiple);
            if (res.ok) {
                return { ok: true }; // inhibitor active
            }
        }
        return { ok: false }; // inhibitor inactive
    }

    // transitionFails ignores guard conditions
    function txFails(testFireArgs) {
        const { state, action, multiple } = testFireArgs;
        const t = def.transitions[action];
        assert(t, "expected transition");
        const res = vectorAdd(state, t.delta, multiple);
        return { out: res.out, ok: !res.ok, role: t.role };
    }

    function testFire(testFireArgs) {
        const { state, action, multiple } = testFireArgs;
        const t = def.transitions[action];
        if (guardFails(testFireArgs).ok) {
            return { out: null, ok: false, role: t.role };
        }
        const res = vectorAdd(state, t.delta, multiple);
        return { out: res.out, ok: res.ok, role: t.role };
    }

    function fire(fireArgs, resolve, reject) {
        let res = testFire(fireArgs);
        switch (def.type) {
            case PFlowModel.stateMachine:
                if (!res.ok) {
                    break;
                }
                let elementaryOutputs = 0;
                let failsHardCap = false;
                for (const i in res.out) {
                    if (res.out[i] > 1) {
                        failsHardCap = true;
                    }
                    if (res.out[i] > 0) {
                        elementaryOutputs++;
                    }
                }
                res.ok = !failsHardCap && elementaryOutputs < 2;
                break;
            case PFlowModel.workflow:
                let wfOutputs = 0;
                let failsWfCap = false;
                const wfOut = emptyVector();
                for (const i in res.out) {
                    if (res.out[i] > 1) {
                        failsWfCap = true;
                    }
                    if (res.out[i] > 0) {
                        wfOutputs++;
                        wfOut[i] = res.out[i];
                    } // NOTE: ignore negative values
                }
                res.out = wfOut;
                res.ok = !failsWfCap && wfOutputs < 2;
                break;
        }
        if (res.ok) {
            for (const i in res.out) {
                fireArgs.state[i] = res.out[i];
            }
            if (resolve) {
                resolve(res);
            }
        }
        if (!res.ok && reject) {
            reject(res);
        }
        return res;
    }

    if (typeof declaration === 'function') {
        declaration({ fn, cell, role });
        if (!index()) {
            throw new Error("invalid declaration");
        }
    }
    if (typeof declaration === 'object') {
        def.places = declaration.places;
        def.transitions = declaration.transitions;
        // TODO: should re-populate the arc defs
    }

    function isClose(a, b) {
        return Math.abs(a - b) < 24; // REVIEW: compare to element handlers r=36
    }

    function isPositionClose(x1, y1, x2, y2) {
        return isClose(x1, x2) && isClose(y1, y2);
    }

    function getNearbyNode(x, y) {
        for (const label in def.places) {
            const p = def.places[label];
            if (isPositionClose(x, y, p.position.x, p.position.y)) {
                return { place: p };
            }
        }
        for (const label in def.transitions) {
            const t = def.transitions[label];
            if (isPositionClose(x, y, t.position.x, t.position.y)) {
                return { transition: t };
            }
        }
    }

    function getNode(label) {
        if (label in def.transitions) {
            return { transition: def.transitions[label] };
        } else if (label in def.places) {
            return { place: def.places[label] };
        }
    }

    function getSize() {
        let limitX = 0;
        let limitY = 0;

        for (const label in def.places) {
            const p = def.places[label];
            if (limitX < p.position.x) {
                limitX = p.position.x;
            }
            if (limitY < p.position.y) {
                limitY = p.position.y;
            }
        }
        for (const label in def.transitions) {
            const t = def.transitions[label];
            if (limitX < t.position.x) {
                limitX = t.position.x;
            }
            if (limitY < t.position.y) {
                limitY = t.position.y;
            }
        }
        const margin = 100;
        return { width: limitX + margin, height: limitY + margin };
    }

    return {
        def,
        dsl: { fn, cell, role },
        capacity: capacityVector(),
        getSize,
        getNode,
        getNearbyNode,
        index,
        txFails,
        guardFails,
        vectorAdd,
        emptyVector,
        initialVector,
        capacityVector,
        testFire,
        fire
    };
}

/**
 * pflow2png - create a png from a pflow declaration
 * requires browser and html canvas support
 *
 * @param canvasId - id of the canvas element
 * @param declaration - pflow declaration function or object
 * @param handler - callback for event bindings
 * @param inputState - initial state
 * @returns {{state: Map<any, any>, history: [], seq: number, models: Map<any, any>, dispatch(*): *, restart(): void}}
 */
function pflow2png({ canvasId, declaration, handler, state: inputState }) {
    const schema = canvasId;
    const domURL = window.URL || window.webkitURL || window;
    const m = pflowModel({ schema, type: PFlowModel.petriNet, declaration });
    const s = pflowStream({ models: [m] });
    const { on } = s.dispatcher;

    s.canvas = document.getElementById(canvasId);
    s.canvas.addEventListener('click', ({ offsetX: x, offsetY: y }) => {
        const n = m.getNearbyNode(x, y); // FIXME: account for canvas scale
        if (n.transition) {
            const { label: action } = n.transition;
            s.dispatch({ schema, action, multiple: 1 });
        }
    });
    if (typeof handler === 'function') {
        handler(s);
    }

    function drawPng(schema) {
        let state = s.state.get(schema);
        let ctx = s.canvas.getContext('2d');
        let img = new Image();
        let svgBlob = new Blob([pflow2svg(s.models.get(schema), { state })], { type: 'image/svg+xml;charset=utf-8' });
        img.src = domURL.createObjectURL(svgBlob);
        img.onload = function () {
            ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
            ctx.drawImage(img, 0, 0);
            domURL.revokeObjectURL(img.src);
        };
    }

    on("__onReload__", (s, evt) => {
        drawPng(evt.schema);
    });
    s.dispatcher.reload(schema);
    return s;
}

/**
 * Convert a pflow model to an SVG string
 * works with browser and nodejs
 * @param model
 * @param options
 * @returns {string}
 */
function pflow2svg(model, options = {}) {
    const tokenTemplate = ({ p, tokens }) => {
        if (tokens === 0) {
            return; // don't show zeros
        }
        if (tokens === 1) {
            return `<circle cx="${p.x}" cy="${p.y}" r="2" fill="black" stroke="black" />`;
        }
        if (tokens < 10) {
            return `<text x="${p.position.x - 4}" y="${p.position.y + 5}">${tokens}</text>`;
        }
        if (tokens >= 10) {
            return `<text  x="${p.x - 7}" y="${p.y + 5}">${tokens}</text>`;
        }
    };
    const arcTemplate = ({ stroke, markerEnd, weight, x1, y1, x2, y2, midX, offsetX, midY, offsetY }) => `<line stroke="${stroke}"  marker-end="${markerEnd}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />` + `<text x="${midX - offsetX}" y="${midY + offsetY}" >${weight}</text>`;
    const transitionTemplate = ({ fill, stroke, t }) => `<rect width="30" height="30" fill="${fill}" stroke="${stroke}" rx="${4}" x="${t.position.x - 15}" y="${t.position.y - 15}" />` + `<text font-size="smaller" x="${t.position.x - 15}" y="${t.position.y - 20}" >${t.label}</text>`;
    const placeTemplate = ({ p }) => `<circle cx="${p.position.x}" cy="${p.position.y}" r="16" fill="white" stroke="black"  />` + `${tokenTemplate({ p, tokens: p.initial })}` + `<text font-size="smaller" x="${p.position.x - 18}" y="${p.position.y - 20}" >${p.label}</text>`;
    const template = ({ page, arcTags, placeTags, transitionTags }) => `<svg width="${page.width}" height="${page.height}" xmlns="http://www.w3.org/2000/svg" >` + `<defs><marker id="markerArrow1" markerWidth="23" markerHeight="13" refX="31" refY="6" orient="auto">` + `<rect width="28" height="3" fill="white" stroke="white" x="3" y="5"/><path d="M2,2 L2,11 L10,6 L2,2"/></marker>` + `<marker id="markerInhibit1" markerWidth="23" markerHeight="13" refX="31" refY="6" orient="auto">` + `<rect width="28" height="3" fill="white" stroke="white" x="3" y="5"/><circle cx="5" cy="6.5" r="4"/></marker></defs>` + `${arcTags} ${placeTags} ${transitionTags}</svg>`;

    function getArcPoints({ source, target }) {
        const x1 = source.position.x;
        const y1 = source.position.y;
        const x2 = target.position.x;
        const y2 = target.position.y;

        const midX = (x2 + x1) / 2;
        const midY = (y2 + y1) / 2 - 8;
        let offsetX = 4;
        let offsetY = 4;

        if (Math.abs(x2 - midX) < 8) {
            offsetX = 8;
        }

        if (Math.abs(y2 - midY) < 8) {
            offsetY = 0;
        }
        return { offsetX, offsetY, x1, y1, x2, y2, midX, midY };
    }

    const defaultOptions = {
        hash_: '%23',
        hash: '#'
    };
    options['hash'] = defaultOptions['hash'];
    console.log(model, 'drawaing');
    const { transitions, places } = model.def;
    const page = model.getSize();
    let transitionTags = '';
    for (const i in transitions) {
        transitionTags += transitionTemplate({
            fill: "white",
            stroke: "black",
            t: transitions[i]
        });
    }
    let place_index = model.emptyVector();
    let placeTags = '';
    for (const i in places) {
        const p = places[i];
        placeTags += placeTemplate({ p: p });
        place_index[p.offset] = p;
    }
    const { hash } = options;
    let arcTags = '';
    for (const txn in transitions) {
        for (const label in transitions[txn].guards) {
            const place = places[label];
            const { offsetX, offsetY, x1, y1, x2, y2, midX, midY } = getArcPoints({ source: transitions[txn], target: place });
            arcTags += arcTemplate({
                // return
                offsetX, offsetY, x1, y1, x2, y2, midX, midY, // pts
                stroke: "black",
                markerEnd: `url(${hash}markerInhibit1)`,
                weight: Math.abs(transitions[txn].guards[label].delta[place.offset])
            });
        }
    }
    // TODO: support snapshot while running
    for (const txn in transitions) {
        for (const i in transitions[txn].delta) {
            const v = transitions[txn].delta[i];
            if (v > 0) {
                const { offsetX, offsetY, x1, y1, x2, y2, midX, midY } = getArcPoints({ source: transitions[txn], target: place_index[i] });
                arcTags += arcTemplate({
                    offsetX, offsetY, x1, y1, x2, y2, midX, midY, // pts
                    stroke: "black",
                    markerEnd: `url(${hash}markerArrow1)`,
                    weight: v
                });
            } else if (v < 0) {
                const { offsetX, offsetY, x1, y1, x2, y2, midX, midY } = getArcPoints({ target: transitions[txn], source: place_index[i] });
                arcTags += arcTemplate({
                    offsetX, offsetY, x1, y1, x2, y2, midX, midY, // pts
                    stroke: "black",
                    markerEnd: `url(${hash}markerArrow1)`,
                    weight: 0 - v
                });
            }
        }
    }
    return template({
        model,
        page,
        placeTags,
        arcTags,
        transitionTags
    });
}

const defaultOptions = {
    marginX: 0,
    marginY: 0
};

/**
 * pflowSandbox requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() which is not recommended in production XXX
 */
function pflowSandbox(options = defaultOptions) {
    return pflowSandboxFactory(s => {
        s.onSave(() => {
            s.clear();
            window.model = s.readModel();
            console.log(window.model);
            s.update(window.model); // FIXME: this is raising errors
            s.reload(s.schema);
        });
        s.onFail(({ state, action, multiple, role }) => {
            s.error(JSON.stringify({
                ts: Date.now(), role, state, action, multiple, ok: false
            }));
        });
        s.onEvery(({ state, action, multiple, role }) => {
            s.echo(JSON.stringify({
                ts: Date.now(), role, state, action, multiple, ok: true
            }));
        });
    }, options);
}

/**
 * pflowSandboxFactory requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() which is not safe in production XXX
 *
 * @param handler callback function used initialize event bindings
 * @param options editor config options
 */
function pflowSandboxFactory(handler, options = defaultOptions) {
    const editor = ace.edit("editor");
    editor.session.setMode("ace/mode/javascript");
    const onSave = handler => {
        editor.commands.addCommand({
            name: "save",
            bindKey: { win: "Ctrl-Enter", mac: "Command-Enter" },
            exec: handler
        });
    };
    const readModel = () => {
        const pos = (x, y) => {
            // convenience function to use relative positions in ace editor
            return { x: options.marginX + x * 60, y: options.marginY + y * 60 };
        };
        const evalModelCall = `;;;pflowModel({ schema: 'pflow-dev', declaration, type: PFlowModel.petriNet })`;
        return eval(editor.getValue() + evalModelCall);
    };
    const onCommand = command => {
        if (command !== '') {
            try {
                const result = eval(command);
                if (result !== undefined) {
                    this.echo(String(result));
                }
            } catch (e) {
                this.error(String(e));
            }
        } else {
            this.echo('');
        }
    };
    const terminal = $('#term').terminal(onCommand, {
        greetings: '',
        name: 'pflow.dev',
        height: window.innerHeight - 630,
        prompt: '> '
    });

    window.model = readModel(); // FIXME: relocate outside the factory function?

    const s = pflow2png({ canvasId: 'pflow-dev', declaration: window.model.def });
    handler({
        error: terminal.error,
        echo: terminal.echo,
        clear: terminal.clear,
        onFail: callback => {
            s.dispatcher.onFail((_, evt) => callback(evt));
        },
        onEvery: callback => {
            s.dispatcher.onEvery((_, evt) => callback(evt));
        },
        update: s.dispatcher.update,
        reload: s.dispatcher.reload,
        restart: s.restart,
        readModel,
        terminal,
        onSave
    });
    s.restart();
}

/**
 * Default code sample is the model of a game of tic-tac-toe
 */
const defaultCodeSample = `function declaration({fn, cell, role}) {
    let dx = 220;
    let dy = 140;

    let X = 'X';
    let O = 'O';

    function row (n) {
        return [
            cell(n+"0", 1, 1, { x: 1*dx, y: (n+1)*dy}),
            cell(n+"1", 1, 1, { x: 2*dx, y: (n+1)*dy}),
            cell(n+"2", 1, 1, { x: 3*dx, y: (n+1)*dy})
        ];
    }
    let board = [ row(0), row(1), row(2) ];

    let players =  {
        X: {
            turn: cell(X, 1, 1, { x: 40, y: 200 }), // track turns, X goes first
            role: role(X), // player X can only mark X's
            next: O,
            dx: -60
        },
        O: {
            turn: cell(O, 0, 1, { x: 830, y: 370}), // track turns, O moves second
            role: role(O), // player O can only mark O's
            next: X,
            dx: 60
        }
    };

    for (let i in  board) {
        for (let j in  board[i]) {
            for (let marking in players) {
                player = players[marking];
                let {position} = board[i][j].place; // use place for relative positioning
                move = fn(marking+i+j, player.role, { // declare a move
                    x: position.x+player.dx, // position using each player's unique delta
                    y: position.y,
                });
                player.turn.tx(1, move); // take turn
                board[i][j].tx(1, move); // take board space
                move.tx(1, players[player.next].turn); // mark next turn
            }
        }
    }
}`;

const sandboxTemplate = (sourceCode, baseurl = "https://cdn.jsdelivr.net/gh/pFlow-dev/pflow-js@main/src/") => `<!DOCTYPE html>
<html lang="en">
<head>
    <title>pflow.dev</title>
    <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
    <script src="https://cdn.jsdelivr.net/npm/jquery.terminal/js/jquery.terminal.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/jquery.terminal/css/jquery.terminal.min.css" rel="stylesheet"/>
    <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.16.0/src-min-noconflict/ace.min.js "></script>
    <style media="screen">
        #editor {
            height: 600px;
            border: 1px solid black;
            margin: 0;
        }
        #pflow-dev {
            float: right;
            border: 1px solid black;
            max-width: 100%;
        }
        #termLink {
            color: white;
        }
        #term {
            min-height: 280px;
            padding: 10px;
            margin: 0;
        }
    </style>
    <script src="${baseurl}pflow.js"></script>
</head>
<body onload=pflowSandbox()>
    <canvas height="600px" id="pflow-dev" width="1116px"></canvas>
    <pre id="editor">${sourceCode}</pre>
    <pre id="term"><a href="https://pflow.dev" id="termLink">pflow.dev</a> - petri-net editor</pre>
</body>
</html>`;

/**
 * pflow@Html can be used from the browser or nodejs
 * ```js
 * require("fs");
 * const p = require('./pflow.js');
 * const { ticTacToe: source } = p.modelSource;
 * fs.writeFileSync('index.html', p.pflow2Html(source,{}));
 * ```
 */
function pflow2Html(source, opts) {
    return sandboxTemplate(source, opts.baseurl);
}

/**
 * pflow@makeSandbox can be only be used from nodejs
 * and will write the code sample to a new index.html pflow editor
 * ```js
 * require('./src/pflow.js').makeSandbox();
 * ```
 * @param source - javascript source code for a pflow model
 */
function makeSandbox(source = defaultCodeSample) {
    if (typeof module !== 'undefined') {
        require("fs").writeFileSync('index.html', pflow2Html(source, {}));
        return 'wrote index.html';
    }
}

if (typeof module !== 'undefined') {
    module.exports = {
        ModelType: PFlowModel,
        newSandbox: pflowSandbox,
        newStream: pflowStream,
        newModel: pflowModel,
        pflow2Html,
        pflow2png,
        pflow2svg,
        modelSource: { ticTacToe: defaultCodeSample },
        makeSandbox
    };
}
