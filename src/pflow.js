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
 * Types of models supported by pflow
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
                console.log({ model }, 'update', model.def.schema);
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

    if (typeof declaration === 'string') {}

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
        if (Object.hasOwn(n, 'transition')) {
            const { label: action } = n.transition;
            s.dispatch({ schema, action, multiple: 1 });
        }
    });
    if (typeof handler === 'function') {
        handler(s);
    }

    const ctx = s.canvas.getContext('2d');

    function drawPng() {
        let state = s.state.get(schema);
        let img = new Image();
        const model = s.models.get(schema);
        let svgBlob = new Blob([pflow2svg(model, { state })], { type: 'image/svg+xml;charset=utf-8' });
        img.src = domURL.createObjectURL(svgBlob);
        img.onload = function () {
            ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
            ctx.drawImage(img, 0, 0);
            domURL.revokeObjectURL(img.src);
        };
    }

    on("__onReload__", (s, evt) => {
        drawPng(); // KLUDGE: doesn't allow switching between schemas
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
    const arcTemplate = ({
        stroke,
        markerEnd,
        weight,
        x1,
        y1,
        x2,
        y2,
        midX,
        offsetX,
        midY,
        offsetY
    }) => `<line stroke="${stroke}"  marker-end="${markerEnd}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />` + `<text x="${midX - offsetX}" y="${midY + offsetY}" >${weight}</text>`;
    const transitionTemplate = ({
        fill,
        stroke,
        t
    }) => `<rect width="30" height="30" fill="${fill}" stroke="${stroke}" rx="${4}" x="${t.position.x - 15}" y="${t.position.y - 15}" />` + `<text font-size="smaller" x="${t.position.x - 15}" y="${t.position.y - 20}" >${t.label}</text>`;
    const placeTemplate = ({ p }) => `<circle cx="${p.position.x}" cy="${p.position.y}" r="16" fill="white" stroke="black"  />` + `${tokenTemplate({
        p,
        tokens: p.initial
    })}` + `<text font-size="smaller" x="${p.position.x - 18}" y="${p.position.y - 20}" >${p.label}</text>`;
    const template = ({
        page,
        arcTags,
        placeTags,
        transitionTags
    }) => `<svg width="${page.width}" height="${page.height}" xmlns="http://www.w3.org/2000/svg" >` + `<defs><marker id="markerArrow1" markerWidth="23" markerHeight="13" refX="31" refY="6" orient="auto">` + `<rect width="28" height="3" fill="white" stroke="white" x="3" y="5"/><path d="M2,2 L2,11 L10,6 L2,2"/></marker>` + `<marker id="markerInhibit1" markerWidth="23" markerHeight="13" refX="31" refY="6" orient="auto">` + `<rect width="28" height="3" fill="white" stroke="white" x="3" y="5"/><circle cx="5" cy="6.5" r="4"/></marker></defs>` + `${arcTags} ${placeTags} ${transitionTags}</svg>`;

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
            const { offsetX, offsetY, x1, y1, x2, y2, midX, midY } = getArcPoints({
                source: transitions[txn],
                target: place
            });
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
                const {
                    offsetX, offsetY, x1, y1, x2, y2, midX, midY
                } = getArcPoints({
                    source: transitions[txn],
                    target: place_index[i]
                });
                arcTags += arcTemplate({
                    offsetX, offsetY, x1, y1, x2, y2, midX, midY, // pts
                    stroke: "black",
                    markerEnd: `url(${hash}markerArrow1)`,
                    weight: v
                });
            } else if (v < 0) {
                const {
                    offsetX, offsetY, x1, y1, x2, y2, midX, midY
                } = getArcPoints({ target: transitions[txn], source: place_index[i] });
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

const defaultPflowSandboxOptions = {
    marginX: 0,
    marginY: 0,
    canvasId: 'pflow-canvas',
    vim: true
};

/**
 * pflowSandbox requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() do not use in production applications XXX
 */
function pflowSandbox(options = defaultPflowSandboxOptions) {
    return pflowSandboxFactory(s => {
        const updatePermaLink = () => {
            pflowZip(s.getValue()).then(data => {
                $('#permalink').attr('href', `https://pflow.dev/?z=${data}`);
            });
        };
        s.onSave(() => {
            updatePermaLink();
            s.update(s.readModel());
            s.clear();
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
        pflowDragAndDrop(s);
        updatePermaLink();
    }, options);
}

const pflowEvalModelSource = options => `;;;pflowModel({ schema: '${options.canvasId}', declaration, type: PFlowModel.petriNet })`;

const pflowStandardFunctionSignature = 'function declaration({fn, cell, role})';

function isValidSource(source) {
    return source.startsWith(pflowStandardFunctionSignature);
}

/**
 * pflowSandboxFactory requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() do not use in production applications XXX
 *
 * @param handler callback function used initialize event bindings
 * @param options editor config options
 */
function pflowSandboxFactory(handler, options = defaultPflowSandboxOptions) {
    const editor = ace.edit("editor");
    editor.session.setMode("ace/mode/javascript");

    if (options.vim) {
        editor.setKeyboardHandler("ace/keyboard/vim");

        ace.config.loadModule("ace/keyboard/vim", function () {
            var VimApi = ace.require("ace/keyboard/vim").CodeMirror.Vim;
            VimApi.defineEx("write", "w", function (cm, input) {
                cm.ace.execCommand("save");
            });
        });
    }

    // convenience function to use relative positions in ace editor
    const pos = (x, y) => {
        return { x: options.marginX + x * 60, y: options.marginY + y * 60 };
    };
    const readModel = () => eval(editor.getValue() + pflowEvalModelSource(options));

    const onSave = handler => {
        editor.commands.addCommand({
            name: "save",
            bindKey: { win: "Ctrl-Enter", mac: "Command-Enter" },
            exec: handler
        });
    };

    const writeModel = source => {
        if (isValidSource(source)) {
            editor.setValue(source);
        } else {
            editor.error('Invalid model source');
        }
    };

    const terminal = $('#term').terminal(command => {
        if (command !== '') {
            try {
                const result = eval(command);
                if (result !== undefined) {
                    terminal.echo(String(result));
                }
            } catch (e) {
                terminal.echo(String(e));
            }
        } else {
            terminal.echo('');
        }
    }, {
        greetings: '',
        name: 'pflow.dev',
        height: window ? window.innerHeight - 670 : 330,
        prompt: '> '
    });

    const s = pflow2png({
        canvasId: options.canvasId,
        declaration: readModel().def
    });

    const sandbox = {
        error: terminal.error,
        echo: terminal.echo,
        clear: terminal.clear,
        setValue: source => editor.session.setValue(source),
        getValue: () => editor.getValue(),
        onFail: callback => {
            s.dispatcher.onFail((_, evt) => callback(evt));
        },
        onEvery: callback => {
            s.dispatcher.onEvery((_, evt) => callback(evt));
        },
        update: s.dispatcher.update,
        reload: s.dispatcher.reload,
        restart: s.restart,
        writeModel,
        readModel,
        terminal,
        onSave
    };
    handler(sandbox);
    s.restart();
    return sandbox;
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

// requires jquery
function pflowDragAndDrop(s) {
    $(document).on("drop", function (e) {
        const { files } = e.originalEvent.dataTransfer;
        e.preventDefault();
        e.stopPropagation();
        if (files.length > 0) {
            const reader = new FileReader();
            reader.onload = evt => {
                const { result: source } = evt.target;
                if (isValidSource(source)) {
                    s.setValue(source);
                    s.update(s.readModel());
                    s.clear();
                    s.reload(s.schema);
                    s.echo("imported.");
                } else {
                    s.error("invalid source - js file expected to begin with:" + pflowStandardFunctionSignature);
                }
            };
            reader.readAsText(files[0]);
        }
    });
    $(document).on("dragover", function (e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'copy';
    });
}

function pflowUnzip(data) {
    return JSZip.loadAsync(data, { base64: true }).then(zip => {
        return zip.file("declaration.js").async("string");
    });
}

function downloadZippedSource(source) {
    return pflowZip(source).then(content => {
        window.location.href = "data:application/zip;base64," + content;
    });
}

// requires JSZip
function pflowZip(source) {
    const zip = new JSZip();
    zip.file("declaration.js", source);
    return zip.generateAsync({
        type: "base64"
    }).then(function (content) {
        return content;
    });
}

const defaultSandboxOptions = {
    baseurl: "https://cdn.jsdelivr.net/gh/pFlow-dev/pflow-js@main"
};

function runPflowSandbox() {
    const s = pflowSandbox();
    $('#simulate').click(evt => pflowToolbarHandler(s, evt));
    $('#download').click(evt => pflowToolbarHandler(s, evt));
}

const pflowGithubLink = `<div>
    <button id="github-button">
    <a id="github-link" target="_blank" href="https://github.com/pFlow-dev/pflow-js">
        <svg width="165" height="33">
         <g transform="translate(0,3)">
            <g transform="translate(4,3)">
                <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2 2 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.2-2.84a3.76 3.76 0 010-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 010 2.93c.83.74 1.2 1.74 1.2 2.94 0 4.21-2.57 5.13-5.04 5.4.45.37.82.92.82 2.02v3.03c0 .27.1.64.73.55A11 11 0 0012 1.27">
                </path>
            </g>
            <text id="github-name" x="30" y="20">@pFlow-dev/pflow-js</text>
        </g>
        </svg>
    </a>
    </button>
</div>`;

const pflowToolbar = `<table id="heading">
<tr><td>
    <a class="pflow-link" target="_blank" href="https://pflow.dev/about">
    <svg id="logo-header" width="45" height="45"><g transform="translate(0,0) scale(1,1)">
    <path fill="#8bb4ccff" d="M24.231 4.526A19.931 19.487 0 0 0 4.3 24.014a19.931 19.487 0 0 0 8.838 16.181l-.714-27.836 4.52-.076.058 2.394c.42-.358.329-.673 2.614-1.88 1.432-.709 3.742-.967 5.745-1.001 3.323-.058 6.362.767 8.49 3.039 2.144 2.272 3.264 5.287 3.36 9.048.097 3.76-.868 6.813-2.894 9.157-2.009 2.343-4.673 3.545-7.996 3.602-2.004.035-3.742-.286-5.21-.96-1.45-.658-3.707-2.113-3.645-2.695l.102 9.367a19.931 19.487 0 0 0 6.663 1.147 19.931 19.487 0 0 0 19.93-19.487 19.931 19.487 0 0 0-19.93-19.488Zm.427 10.295c-2.378.04-4.228.893-5.554 2.555-1.31 1.676-1.925 3.957-1.851 6.849.074 2.892.98 5.148 2.374 6.763.64.583 1.281 1.06 1.935 1.452v-7.312H19.53v-1.392h2.03v-.758c0-1.214.333-2.097 1.003-2.648.669-.558 1.732-.839 3.185-.839h2.006v1.491h-2.03c-.762 0-1.292.13-1.592.39-.292.26-.44.726-.44 1.4v.964h3.496v1.392h-3.495v8.224a7.613 7.613 0 0 0 2.486.217c1.856-.07 3.841-.9 5.15-2.576 1.327-1.662 2.02-4.165 1.946-7.057-.074-2.892-.92-5.267-2.331-6.896-1.394-1.615-3.908-2.26-6.287-2.219zm.447 11.137h.378v3.072h-.378zm2.06.806c.328 0 .586.102.774.307.187.206.28.49.28.855 0 .362-.093.647-.28.854-.188.205-.446.308-.775.308-.33 0-.588-.103-.776-.308-.186-.207-.277-.492-.277-.854 0-.364.091-.65.277-.855.188-.205.447-.307.776-.307zm1.459.055H29l.474 1.726.47-1.726h.446l.47 1.726.47-1.726h.379l-.602 2.211h-.445l-.494-1.813-.499 1.813h-.443zm-1.46.252a.575.575 0 0 0-.48.23c-.118.152-.178.36-.178.625 0 .264.058.473.174.626.118.151.28.228.484.228a.573.573 0 0 0 .48-.23c.117-.153.174-.361.174-.624s-.057-.469-.175-.621a.573.573 0 0 0-.479-.234z">
    </path></g>
    </svg></a>
</td><td>
    <button id="simulate" class="btn">Simulate</button>
    <button id="download" class="btn">Download</button>
    <button id="share" class="btn"><a id="permalink" href="#">Permalink</a></button>
</td></tr>
</table>`;

async function pflowToolbarHandler(s, { target }) {
    switch (target.id) {
        case 'simulate':
            s.clear();
            s.reload(s.schema);
            s.echo("restarted." + Date.now());
            break;
        case 'download':
            s.echo("download." + Date.now());
            const source = s.getValue();
            downloadZippedSource(source);
            break;
    }
}

/**
 * pflow@Html can be used from the browser or nodejs
 * ```js
 * require("fs");
 * const p = require('./pflow.js');
 * const { ticTacToe: source } = p.modelSource;
 * fs.writeFileSync('index.html', p.pflow2Html(source,{}));
 * ```
 */
const pflow2html = (sourceCode, opts = defaultSandboxOptions) => `<!DOCTYPE html>
<html lang="en">
<head>
    <title>pflow.dev</title>
    <meta charset="utf-8"/>
    <meta name="description" content="pflow.dev petri-net sandbox"/>
    <meta name="author" content="pflow.dev"/>
    <meta name="keywords" content="pflow, petri-net, sandbox"/>
    <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
    <script src="https://cdn.jsdelivr.net/npm/jquery.terminal/js/jquery.terminal.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/jquery.terminal/css/jquery.terminal.min.css" rel="stylesheet"/>
    <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.16.0/src-min-noconflict/ace.min.js "></script>
    <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
    <link href="${opts.baseurl}/styles/pflow.css" rel="stylesheet"/>
    <script src="${opts.baseurl}/src/pflow.js"></script>
</head>
<body onload=(runPflowSandbox())>
${pflowGithubLink}
${pflowToolbar}
<canvas height="600px" id="pflow-canvas" width="1116px"></canvas>
<pre id="editor">${sourceCode}</pre>
<pre id="term"><a class="pflow-link" target="_blank" href="https://pflow.dev/about">pflow.dev petri-net editor</a></pre>
</body>
</html>`;

/**
 * sandbox is generated from nodejs
 * and will write the code sample to a new index.html pflow editor
 * ```js
 * require('./src/pflow.js').makeSandbox();
 * ```
 * @param source - javascript source code for a pflow model
 * @param opts - template options
 */
if (typeof module !== 'undefined') {
    function makeSandbox(source = defaultCodeSample, opts = {}) {
        const baseurl = opts.baseurl || '.';
        require("fs").writeFileSync('index.html', pflow2html(source, { baseurl }));
        return 'wrote index.html';
    }

    module.exports = {
        ModelType: PFlowModel,
        newSandbox: pflowSandbox,
        newStream: pflowStream,
        newModel: pflowModel,
        pflow2html,
        pflow2png,
        pflow2svg,
        modelSource: { ticTacToe: defaultCodeSample },
        makeSandbox
    };
}
