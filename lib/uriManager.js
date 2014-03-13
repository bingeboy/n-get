var path = require("path");
var colors = require("colors");

module.exports = function requestUri(reqUrl) {
    var url = require("url").parse(reqUrl, true);

    if(!url.protocol) {
        url.protocol = "http";
        console.log("No Protocal Provided Defaulting to: ".red, url.protocol);
    }
    require("url").format(url);
    //Rebuild the uri based on rules from aboe
    reqUrl = path.normalize(reqUrl);

    return reqUrl;
}
