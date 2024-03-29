# pflow-js: Petri-net Sandbox

[![](https://data.jsdelivr.com/v1/package/gh/pflow-dev/pflow-js/badge)](https://www.jsdelivr.com/package/gh/pflow-dev/pflow-js)

Pflow-js is an open-source (MIT) toolkit for
interactive editing and simulation of Petri nets,
designed for ease of embedding and sharing.

Supports: Workflows, Petri-Nets, and State-Machines.

Try it out!

- A JS sandbox that can view Petri-Nets
  - https://pflow-dev.github.io/pflow-js/sandbox.html

- Interactive Petri-Net Editor
  - https://pflow-dev.github.io/pflow-js/p/

- Our model hosting site https://pflow.dev 
  - can render an svg image for markdown:

```
[![pflow](https://pflow.dev/img/zb2rhnPRsyYbyGc2sVkVStXJ8bzqrXR1RQPkvCjf3qnHFK56A.svg)](https://pflow.dev/p/zb2rhnPRsyYbyGc2sVkVStXJ8bzqrXR1RQPkvCjf3qnHFK56A/)
```

[![pflow](https://pflow.dev/img/zb2rhnPRsyYbyGc2sVkVStXJ8bzqrXR1RQPkvCjf3qnHFK56A.svg)](https://pflow.dev/p/zb2rhnPRsyYbyGc2sVkVStXJ8bzqrXR1RQPkvCjf3qnHFK56A/)

Key Features
------------
- Interactive Petri Net Editing
  - Create and modify Petri nets with an intuitive, user-friendly interface.
- Dynamic Simulation
  - Simulate and visualize Petri net behavior in real-time within the browser.
- Embedding and Exporting
  - Easily embed interactive Petri nets in websites and export them for sharing.

## pflow-editor

The interactive editor react app is published to this repo's `./p` folder.

 https://github.com/pFlow-dev/pflow-editor

 ## Deploy using CDN

Use the jsdelivr CDN to host your own version of the app

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>pflow.dev | metamodel editor</title>
    <script defer="defer" src="https://cdn.jsdelivr.net/gh/pflow-dev/pflow-js@1.1.2/p/static/js/main.5dc69f67.js"> </script>
    <link href="https://cdn.jsdelivr.net/gh/pflow-dev/pflow-js@1.1.2/p/static/css/main.63d515f3.css" rel="stylesheet">
</head>
<body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
</body></html>
```
