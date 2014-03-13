var path = require("path");
var colors = require("colors");

module.exports = function requestUri(reqUrl) {
    //regex
    var uriCheck = /^((http[s]?|ftp):\/\/)?\/?([^\/\.]+\.)*?([^\/\.]+\.[^:\/\s\.]{2,3}(\.[^:\/\s\.]‌​{2,3})?)(:\d+)?($|\/)([^#?\s]+)?(.*?)?(#[\w\-]+)?$/;

    //URI chuckiness
    var url, protocol, host, rpath, file, query, hash;

    //Test the URI
    if(uriCheck.test(reqUrl)){
        //regex positions:
        /*
        console.log("URL: ", RegExp['$&']);
        console.log("protocol: ", RegExp.$2);
        console.log("host:", RegExp.$3);
        console.log("path:", RegExp.$4);
        console.log("file:", RegExp.$6);
        console.log("query:", RegExp.$7);
        console.log("hash:", RegExp.$8);
        */
        url =  RegExp['$&']
        , host = RegExp.$3
        , rpath = RegExp.$4
        , file = RegExp.$6
        , query = RegExp.$7
        , hash = RegExp.$8

        if(protocol = "") {
            protocol = "http:/";
            console.log("No Protocal Provided Defaulting to: ".red, protocol);
        } else{
            protocol = RegExp.$2 + ":/"
        }

        //Rebuild the uri based on rules from aboe
        reqUrl = host + "/"+ rpath + "/" + file+ "/" + query + "/" + hash; //TODO map this hackolishishnessesmess
        reqUrl = protocol + path.normalize(reqUrl);
    }
    return reqUrl;
}
