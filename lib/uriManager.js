var path = require("path");
var colors = require("colors");

module.exports = function requestUri(reqUrl) {
    var url = require("url").parse(reqUrl, true);

    if(!url.protocol) {
        url.protocol = "http";
        url.slashes = true;
        url.host = url.pathname;
        url.pathname = "/";
        console.log("No Protocal Provided Defaulting to:".red, url.protocol);
    }

    //Rebuild the uri based on conditionals from aboe
    reqUrl = require("url").format(url);

    return reqUrl;
}
