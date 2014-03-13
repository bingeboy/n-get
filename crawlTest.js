
var Crawler = require("crawler").Crawler;

var c = new Crawler({
"maxConnections":10,

// This will be called for each crawled page
"callback":function(error,result,$) {

    // $ is a jQuery instance scoped to the server-side DOM of the page
    $("#content a").each(function(index,a) {
        console.log("This getting cralwed", a);
        c.queue(a.href);
    });
}
});

// Queue just one URL, with default callback
c.queue("http://joshfire.com");
