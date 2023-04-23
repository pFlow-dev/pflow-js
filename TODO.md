TODO
---- 

This browser-compatible library can be used to render a model in a browser.
It can also be used as an NPM package to export/share models in an HTML sandbox.

- [ ] support all the pflow modes: workflow, statemachine, petriNet

BACKLOG
-------
- [ ] fix bug where tokens are not visible in snapshot
- [ ] fix bug where tokens are not rendered properly (same bug as construction in other project?)
- [ ] fix onClick issue when scaling the canvas
- [ ] enable colors when running
- 
- [ ] make sandbox configurable
      * so that we can load without the menu or terminal or editor
      * show/hide the code pallet and console (but not the graphic)

ICEBOX
------
- [ ] support toggling vim mode (perm per browser - via cli or button)
- [ ] support opening zip files via drag and drop (add collection support?)
      i.e. should be able to open our own output
- [ ] calculate IPFS CID/LINK for source code in the browser
- [ ] extend DSL to select a model-type - will default to 'workflow' if initial and capacities match
- [ ] force-atlas re-arranging 
- [ ] add a pop-up to render new HTML templates for sharing
- [ ] consider supporting actual arc's (curves) as arcs!!
- [ ] add a way check state from the console
