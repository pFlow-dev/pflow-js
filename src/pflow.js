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
                this.models.set(model.def.schema, model);
            },
            reload: schema => {
                eventHandlers.get("__onReload__")(this, { action: 'reload', schema });
            }
        };
        this.dispatch = this.dispatch.bind(this);
        this.restart = this.restart.bind(this);
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
    // TODO: use inputState
    const schema = canvasId;
    const domURL = window.URL || window.webkitURL || window;
    const m = pflowModel({ schema, type: PFlowModel.petriNet, declaration });
    const s = pflowStream({ models: [m] });
    const { on } = s.dispatcher;
    const size = { width: 1116, height: 600 }; // hardcoded SVG size
    s.canvas = document.getElementById(canvasId);

    s.canvas.addEventListener('click', ({ offsetX: x, offsetY: y }) => {
        const scaled = {
            x: x * (size.width / s.canvas.clientWidth),
            y: y * (size.height / s.canvas.clientHeight)
        };
        const n = s.models.get(schema).getNearbyNode(scaled.x, scaled.y);
        if (n && Object.hasOwn(n, 'transition')) {
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
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
            ctx.drawImage(img, 0, 0);
            domURL.revokeObjectURL(img.src);
        };
    }

    on("__onReload__", () => {
        drawPng();
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

    const state = options.state || model.initialVector();

    const tokenTemplate = ({ p, tokens }) => {
        if (tokens === 0) {
            return; // don't show zeros
        }
        if (tokens === 1) {
            return `<circle cx="${p.position.x}" cy="${p.position.y}" r="2" fill="black" stroke="black" />`;
        }
        if (tokens < 10) {
            return `<text x="${p.position.x - 4}" y="${p.position.y + 5}">${tokens}</text>`;
        }
        if (tokens >= 10) {
            return `<text  x="${p.position.x - 7}" y="${p.position.y + 5}">${tokens}</text>`;
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
        tokens: state[p.offset]
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
        const { ok } = model.testFire({
            state, action: transitions[i].label, multiple: 1
        });
        const { ok: guardFails } = model.guardFails({
            state, action: transitions[i].label, multiple: 1
        });

        const hasGuard = Object.keys(transitions[i].guards).length > 0;

        let fill = "white";
        if (ok) {
            fill = "#62fa75"; // green
        } else if (hasGuard && guardFails) {
            fill = "#fab5b0"; // red
        }

        transitionTags += transitionTemplate({
            fill,
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
    vim: false // don't use vim mode by default
};

/**
 * pflowSandbox requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() do not use outside of sandbox applications XXX
 */
function pflowSandbox(options = defaultPflowSandboxOptions) {
    return pflowSandboxFactory(s => {
        const updatePermaLink = () => {
            pflowZip(s.getValue()).then(data => {
                // get current URL with no params
                const url = window.location.href.split('?')[0];
                $('#share').attr('href', `${url}?z=${data}`);
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

// REVIEW: possibly support different function signatures for each type of model
const pflowStandardFunctionSignature = 'function declaration({fn, cell, role})';

function isValidSource(source) {
    return source.startsWith(pflowStandardFunctionSignature);
}

function pflowTermDSL(editor, options) {

    // convenience function to use relative positions in ace editor
    const pos = (x, y) => {
        return { x: options.marginX + x * 60, y: options.marginY + y * 60 };
    };
    const readModel = () => {
        return eval(editor.getValue() + pflowEvalModelSource(options));
    };

    const onSave = handler => {
        editor.commands.addCommand({
            name: "save",
            bindKey: { win: "Ctrl-Enter", mac: "Command-Enter" },
            exec: handler
        });
    };

    return { onSave, readModel, pos };
}

/**
 * pflowSandboxFactory requires JQuery and Ace editor to be present in browser
 * XXX this makes use of eval() do not use outside of sandbox applications XXX
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
            const VimApi = ace.require("ace/keyboard/vim").CodeMirror.Vim;
            VimApi.defineEx("write", "w", function (cm, input) {
                cm.ace.execCommand("save");
            });
        });
    }

    const { readModel, onSave } = pflowTermDSL(editor, options);

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
        height: 390,
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
const defaultCodeSample = `${pflowStandardFunctionSignature} {

    // REVIEW: code in use at https://pflow.dev/demo/tictactoe/

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
                    s.restart();
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
    if (window !== undefined) {
        // ideal is to say within one std IPFS chunk
        const kbSize = new TextEncoder().encode(source).length / 1024;
        if (kbSize > 256) {
            alert('source code limit is 256 kb');
            console.error('source code limit is 256 kb');
            return;
        }
    }
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

async function getQueryParams(str = window.location.search, separator = '&') {
    const obj = {};
    if (str.length === 0) return obj;
    const c = str.substr(0, 1);
    const s = c === '?' || c === '#' ? str.substr(1) : str;

    const a = s.split(separator);
    for (let i = 0; i < a.length; i++) {
        const p = a[i].indexOf('=');
        if (p < 0) {
            obj[a[i]] = '';
            continue;
        }
        let k = decodeURIComponent(a[i].substr(0, p)),
            v = decodeURIComponent(a[i].substr(p + 1));

        const bps = k.indexOf('[');
        if (bps < 0) {
            obj[k] = v;
            continue;
        }

        const bpe = k.substr(bps + 1).indexOf(']');
        if (bpe < 0) {
            obj[k] = v;
            continue;
        }

        const bpv = k.substr(bps + 1, bps + bpe - 1);
        k = k.substr(0, bps);
        if (bpv.length <= 0) {
            if (typeof obj[k] != 'object') obj[k] = [];
            obj[k].push(v);
        } else {
            if (typeof obj[k] != 'object') obj[k] = {};
            obj[k][bpv] = v;
        }
    }
    return obj;
}

function pflowToggleOption(id) {
    const option = $(id);
    if (option.is(':visible')) {
        option.hide();
    } else {
        option.show();
    }
}

async function runPflowSandbox() {
    const s = pflowSandbox();
    $('#simulate').on('click', evt => pflowToolbarHandler(s, evt));
    $('#download').on('click', evt => pflowToolbarHandler(s, evt));
    $('#embed').on('click', evt => pflowToolbarHandler(s, evt));
    $.urlParam = function (name) {
        // REVIEW: do we really want this?
        const results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.search);
        return results !== null ? results[1] || 0 : false;
    };
    $('#viewCode').on('change', () => pflowToggleOption('#editor'));
    $('#viewTerminal').on('change', () => pflowToggleOption('#term'));
    $('#share').on('click', () => {
        pflowToolbarHandler(s, { target: { id: 'share' } });
        return false;
    });
    return getQueryParams().then(async params => {
        if (params.z) {
            // REVIEW: could have a max limit here too
            const kbSize = new TextEncoder().encode(params.z).length / 1024;
            console.log({ kbSize }, 'loading zipped source');
            const source = await pflowUnzip(params.z);
            s.setValue(source);
            s.update(s.readModel());
            s.clear();
            s.reload(s.schema);
            s.echo("imported.");
        }
    });
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
        </svg>GithubStars
    </a>
    </button>
</div>`;

const pflowStats = `<table id="cdn-stats">
<tr><td>
<a href="https://www.jsdelivr.com/package/gh/pflow-dev/pflow-js" rel="nofollow noopener noreferrer" class="router-ignore"><img alt="" src="https://data.jsdelivr.com/v1/package/gh/pflow-dev/pflow-js/badge" loading="lazy"></a>
</td><td>
&nbsp;&nbsp;&nbsp;
</td><td>
<iframe src="https://ghbtns.com/github-btn.html?user=pFlow-dev&repo=pflow-js&type=star&count=true&size=large" frameborder="0" scrolling="0" width="130" height="40" title="GitHub">
</iframe>
</td></tr>
</table>`;

const pflowToolbar = `<table id="heading">
<tr><td>
    <a class="pflow-link" target="_blank" href="">
    <svg id="logo-header" width="45" height="45" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="enable-background:new 0 0 194.9 47.8" viewBox="0 0 47.8 47.8"><path d="M24.57 35.794c.177-.033.433-.032.57.002.135.035-.01.062-.322.06-.313 0-.424-.03-.247-.062zM11.585 28.84c0-1.102.022-1.553.05-1.002.026.551.026 1.454 0 2.005-.028.551-.05.1-.05-1.003zM4.05 23.932c0-1.064.023-1.481.05-.927.027.555.027 1.426 0 1.936-.028.51-.05.056-.05-1.009zm2.965-2.79a1.2 1.2 0 0 1 .497 0c.137.034.025.062-.249.062-.273 0-.385-.028-.248-.063zm7.924-5.479c0-.024.208-.226.462-.45l.462-.405-.418.449c-.389.419-.506.513-.506.406zm-4.406-5.418c.265-.266.514-.484.553-.484.039 0-.146.218-.411.484s-.514.484-.554.484c-.039 0 .146-.218.412-.484z" style="fill:#d0d0d0;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M11.563 26.421c.002-.304.031-.412.065-.24s.033.42-.003.553c-.035.132-.063-.009-.062-.313zm16.618-2.42c0-.19.032-.267.071-.172a.52.52 0 0 1 0 .345c-.04.095-.071.018-.071-.172zm-12.745-8.018c.142-.152.29-.277.329-.277.039 0-.045.125-.186.277-.142.152-.29.276-.329.276-.039 0 .045-.124.186-.276zm9.135-4.107c.176-.034.432-.032.568.002.136.035-.009.062-.321.06-.313-.001-.424-.03-.247-.062z" style="fill:#b9b9b9;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M11.55 25.66c0-.19.032-.267.072-.172a.52.52 0 0 1 0 .345c-.04.095-.072.018-.072-.172zm25.74-1.728c.003-.304.032-.412.066-.24s.032.42-.003.553c-.036.132-.064-.008-.062-.313zm-29.2-2.79c.102-.04.225-.035.272.01.047.047-.037.08-.187.074-.165-.007-.199-.04-.085-.084z" style="fill:#a3a3a3;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="m9.804 37.309-.195-.242.248.19c.137.104.25.213.25.241 0 .114-.118.04-.303-.19zm1.746-12.201c0-.19.032-.268.072-.173a.52.52 0 0 1 0 .345c-.04.095-.072.018-.072-.172zm-3.034-3.966c.103-.04.225-.035.272.01.048.047-.036.08-.186.074-.166-.007-.2-.04-.086-.084z" style="fill:#8c8c8c;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M19.226 40.592c0-.19.032-.268.071-.173a.52.52 0 0 1 0 .346c-.04.095-.071.017-.071-.173z" style="fill:#767676;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M19.214 41.065c.007-.162.04-.194.086-.084.041.1.036.219-.01.265-.048.046-.082-.036-.076-.181zm.028-1.302c0-.343.028-.483.062-.311.033.17.033.45 0 .622-.034.17-.062.03-.062-.311zM44.089 24.75c.007-.16.04-.193.086-.083.041.1.036.219-.011.265-.047.046-.081-.036-.075-.182zm-21.332-2.874c0-.03.112-.138.248-.242l.25-.19-.196.242c-.186.23-.302.303-.302.19zm-13.53-.734c.102-.04.225-.035.272.01.047.047-.037.08-.186.074-.166-.007-.2-.04-.086-.084z" style="fill:#606060;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M19.244 38.587c.001-.38.029-.519.061-.309.033.21.032.521-.002.692-.033.17-.06-.002-.06-.383zm14.173-5.928c0-.028.112-.137.249-.242l.249-.19-.195.243c-.186.23-.303.303-.303.19zm10.694-8.52c0-.265.03-.374.065-.241.036.133.036.35 0 .484-.036.133-.065.024-.065-.242zm-.022-.771c.007-.161.04-.194.086-.084.041.1.036.22-.011.265-.047.046-.081-.035-.075-.181zM9.653 21.142c.103-.04.225-.035.273.01.047.047-.037.08-.187.074-.166-.007-.2-.04-.086-.084zM37.521 9.519l-.195-.242.249.19c.237.18.312.294.195.294-.03 0-.141-.109-.249-.242zM23.156 4.551c.103-.04.226-.035.273.011.047.046-.037.079-.187.073-.165-.007-.199-.04-.086-.084z" style="fill:#494949;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/><path d="M22.293 43.077c-1.266-.14-3.605-.666-4.945-1.113-5.51-1.835-10.571-6.878-12.408-12.363-.716-2.138-.8-2.733-.802-5.709-.002-3.09.133-4.032.871-6.089 1.558-4.342 4.184-7.533 8.422-10.233 2.703-1.723 5.62-2.658 9.153-2.933 3.997-.31 7.31.333 10.887 2.117 3.071 1.532 6.032 4.227 7.814 7.111 1.97 3.19 2.807 6.176 2.802 9.985-.004 2.959-.353 4.778-1.378 7.186-2.039 4.79-6.483 8.972-11.495 10.815-2.816 1.035-6.31 1.516-8.921 1.226zm-3.057-1.448c.067-.228.08-1.892.028-3.698-.052-1.806-.063-3.284-.024-3.284.038 0 .35.12.691.265.343.145 1.39.432 2.328.637l1.706.373 1.635-.079c2.01-.097 2.93-.327 4.78-1.199 2.24-1.054 3.708-2.327 5.122-4.445 2.557-3.83 2.485-8.985-.182-12.921-2.456-3.625-6.56-5.614-11.142-5.398-3.473.163-5.736 1.2-8.464 3.877-1.57 1.541-2.5 2.87-3.187 4.565-.917 2.257-.9 2.07-.954 10.316l-.05 7.535 1.177.847c1.73 1.245 3.291 2.13 4.655 2.639 1.437.535 1.715.53 1.88-.03zm4.825-14.735c-.735-.219-1.674-1.223-1.932-2.066-.592-1.94.91-3.874 3.004-3.865 1.718.008 3.025 1.362 3.025 3.133 0 .862-.655 1.972-1.437 2.436-.736.437-1.883.593-2.66.362zm-13.69-5.748 1.305-.09.55-1.141c1.527-3.17 3.556-5.351 6.497-6.987.694-.386 1.338-.774 1.431-.863.131-.124.124-.772-.03-2.857-.11-1.483-.202-2.824-.205-2.98a1.044 1.044 0 0 0-.183-.52l-.177-.235-1.06.286c-1.447.39-4.04 1.612-5.69 2.68-1.448.938-3.48 2.868-4.745 4.505-1.539 1.993-3.742 7.44-3.294 8.144.106.168 3.503.203 5.602.058z" style="fill:#333;fill-opacity:1;stroke-width:.140185" transform="matrix(1.05551 0 0 1.0735 -1.74 -1.355)"/></svg>
    </a>
</td><td>
   <div class="tooltip">
       <button id="simulate" class="btn">
           <svg width="12" height="14">
           <g transform="translate(-2,0) scale(.7,.7)">
           <path d="M8 5v14l11-7z"></path>
           </g>
           </svg>
       Simulate</button>
       <span class="tooltiptext">{Ctl+Enter} to run model</span>
   </div>
  <div class="tooltip">
   <button id="download" class="btn">
       <svg width="12" height="14">
       <g transform="translate(-2,0) scale(.66,.66)">
       <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"></path>
       </g>
       </svg> Download</button>
     <span class="tooltiptext">download.zip</span>
   </div>
  <div class="tooltip">
  <a id="share" target=_blank >
  <button id="permalink" class="btn">
     <svg width="18" height="14">
     <g transform="scale(.8,.8)">
     <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"></path>
     </g>
     </svg> Link
     </button>
     </a>
     <span class="tooltiptext">copy link to clipboard</span>
  </div>
  <div class="tooltip">
  <button id="embed" class="btn">
     <svg width="18" height="14">
     <g transform="translate(2,0) scale(.6,.6)">
     <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"></path>
     </g>
     </svg> Embed</button>
     <span class="tooltiptext">copy iframe widget source</span>
  </div>
  <a href="https://pflow.dev/help" target="_blank">
  <button id="help" class="btn">
     <svg width="18" height="14">
     <g transform="translate(0,1) scale(.6,.6)">
      <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"></path>
     </g>
     </svg>Help</button>
</a>
</td><td>
    <input type="checkbox" id="viewCode" class="feature-flag" checked>Code</input>
    <input type="checkbox" id="viewTerminal" class="feature-flag" checked>Terminal</input>
</td></tr>
</table>`;

async function pflowToolbarHandler(s, evt) {
    switch (evt.target.id) {
        case 'simulate':
            s.clear();
            s.restart();
            s.reload(s.schema);
            s.echo("restarted." + Date.now());
            break;
        case 'download':
            s.echo("download." + Date.now());
            return downloadZippedSource(s.getValue());
        case 'embed':
            s.echo("embed." + Date.now());
            return pflowZip(s.getValue()).then(data => {
                navigator.clipboard.writeText(pflowWidgetTemplate(data));
            });
        case 'share':
            s.echo("link." + Date.now());
            return navigator.clipboard.writeText($("#share").attr('href'));
    }
}

const pflowWidgetTemplate = (sourceCode, opts = defaultSandboxOptions) => `<!DOCTYPE html>
<html lang="en">
<head>
    <title>pflow.dev</title>
    <meta charset="utf-8"/>
    <meta name="description" content="open source petri-net editor pflow.dev"/>
    <meta name="keywords" content="pflow, petri-net, sandbox"/>
    <style>
        body {
            margin: auto;
            max-width: 1000px;
        }
        iframe {
            border : 0;
        }
    </style>
</head>
<body>
<iframe id="pflow-model" width="1000" height="1550" src="${window.location.href.split('?')[0]}?z=${sourceCode}">
</iframe>
</body>
</html>`;

/**
 * pflow@html can be used from the browser or nodejs
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
    <script>
        defaultPflowSandboxOptions.vim = false;
    </script>
</head>
<body onload=(runPflowSandbox())>
${pflowStats}
${pflowToolbar}
<canvas id="pflow-canvas" height="600px" width="1116px"></canvas>
<pre id="editor">${sourceCode}</pre>
<pre id="term"><a class="pflow-link" target="_blank" href="https://pflow.dev/about">pflow.dev petri-net editor</a></pre>
</body>
</html>`;

if (typeof module !== 'undefined') {

    module.exports = {
        ModelType: PFlowModel,
        newSandbox: pflowSandbox,
        newStream: pflowStream,
        newModel: pflowModel,
        unzip: pflowUnzip,
        zip: pflowZip,
        pflow2html,
        pflow2png,
        pflow2svg,
        modelSource: { ticTacToe: defaultCodeSample }
    };
}
