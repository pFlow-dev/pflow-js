# pflow-js

[![](https://data.jsdelivr.com/v1/package/gh/pflow-dev/pflow-js/badge)](https://www.jsdelivr.com/package/gh/pflow-dev/pflow-js)

Pflow-js is an open-source (MIT) toolkit for coding peti-net models.

Supports: Workflows, Petri-Nets, and State-Machines.


## Status

Beta - some known issues w/ canvas interaction & rendering


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
