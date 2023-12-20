import { newModel, modelSource, pflow2html, pflow2svg } from "../src/pflow.js"
describe("metamodel", () => {

    it("should run test model", () => {
        const m = newModel({
            schema: "test",
            declaration: (({fn, cell, role}) => {
                const pos = (x, y) => { // convert to pixels
                    return {x: x * 60, y: y * 60};
                }
                let r = role("default");
                let p1 = cell('p1', 1, 0, pos(1, 1));
                let p2 = cell('p2', 0, 0, pos(5, 1));
                let p3 = cell('p3', 1, 0, pos(1, 3));
                let p4 = cell('p4', 0, 0, pos(5, 3));

                let t1 = fn('init', r, pos(3, 2));
                t1.tx(1, p1)
                t1.tx(1, p2)
                t1.tx(1, p3)
                t1.tx(1, p4)
            }),
        });

        const state = m.initialVector()
        expect(state).toEqual([1, 0, 1, 0])
    });

    it("should generate html", () => {
        const out = pflow2html(modelSource.ticTacToe, { baseurl: "./src/"})
        expect(out.startsWith('<!DOCTYPE html>')).toBeTruthy()
    });

    it("should load a model defined by an object", () => {
        const declaration = {
            "modelType": "petriNet",
            "version": "v0",
            "places": {
                "foo": { "offset": 0, "x": 480, "y": 320, "initial": 1, "capacity": 3 }
            },
            "transitions": {
                // "bar": { "x": 400, "y": 400 },
                // "baz": { "x": 560, "y": 400 },
                "add": { "x": 400, "y": 240 },
                "sub": { "x": 560, "y": 240 }
            },
            "arcs": [
                { "source": "add", "target": "foo", "weight": 1 },
                { "source": "foo", "target": "sub", "weight": 1 },
                // { "source": "bar", "target": "foo", "weight": 3, "inhibit": true },
                //{ "source": "foo", "target": "baz", "weight": 1, "inhibit": true }
            ]
        };
        const m = newModel({ schema: 'test', declaration, type: 'petriNet' });
        const { places, transitions, arcs } = m.def;
        console.log(JSON.stringify({places, transitions, arcs}, null, 2));
        console.log(JSON.stringify(m.toObject(), null, 2));

        // convert model to svg
        const svg = pflow2svg(m);
        // write to fs
        const fs = require('fs');
        fs.writeFileSync('/tmp/test.svg', svg);

    })


});