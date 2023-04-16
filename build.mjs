import {writeFileSync} from "fs";
import pflow from "./src/pflow.js";
const {modelSource, pflow2Html} = pflow;

function build(){
    writeFileSync("index.html", pflow2Html(modelSource.ticTacToe, { baseurl: "./src/"}))
}

build();
