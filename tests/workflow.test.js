import { newModel } from "../src/pflow.js"
describe("workflow", () => {

    it("should load a model defined by an object", () => {
        const declaration = {
            "modelType": "workflow",
            "version": "v0",
            "places": {
            },
            "transitions": {
            },
            "arcs": [
            ]
        };
        const m = newModel({ schema: 'test', declaration, type: 'petriNet' });
        const { places, transitions, arcs } = m.def;
        console.log(JSON.stringify({places, transitions, arcs}, null, 2));
        console.log(JSON.stringify(m.toObject(), null, 2));
    })


});