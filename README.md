# pflow-js

[![](https://data.jsdelivr.com/v1/package/gh/pflow-dev/pflow-js/badge)](https://www.jsdelivr.com/package/gh/pflow-dev/pflow-js)

Pflow-js provides an event-driven framework for coding with models.

Supports: Workflows, Petri-Nets, and State-Machines.

```js
module.exports = {
    ModelType: PFlowModel, // model types constant / enum
    newSandbox: pflowSandbox, // browser-only loads sandbox & event handlers int the browser
    newStream: pflowStream, // browser or nodejs - construct a new stream
    newModel: pflowModel, // browser or nodejs - construct a new model
    pflow2Html, // browser or nodejs - export source code w/ sandbox template
    pflow2png, // browser only - render a png using html5/canvas
    pflow2svg, // browser or nodejs - export diagram as an svg string
    modelSource: { ticTacToe: defaultCodeSample }, // default code samples
    makeSandbox // nodejs-only - write a new sandbox index.html
};
```