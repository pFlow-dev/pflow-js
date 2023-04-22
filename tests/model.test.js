import { newModel, modelSource, pflow2html } from "../src/pflow.js"
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


});