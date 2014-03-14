#! /usr/bin/env node

//modules
var path = require("path")
, argv = require("minimist")(process.argv)
, chdir = require("./lib/chdir")
, uriManager = require("./lib/uriManager")
, Crawler = require("simplecrawler");
//argv
var  destination
, argvs
, startPath
, fileNameLocal
, spiderDomain
, reqUrls = [ ]
, startPath;


// print process.argv TODO make this a module in utils
process.argv.forEach(function(val, index, array) {
    //grab next index value for destination to write
    if (val === "-d") {
        console.log("this is indeex", index);
        array.slice(index, index+1);
        return destination = array[index+1];
    }
    //crawl domain and log
    if (val === "-rl") {
        var x = array.slice(index, index+1);
        console.log(x,"xxxxxxxxxxxxxxxxxxxxxx");
        return spiderDomain = array[index+1];
    }
    //push values to array for processing
    else if ( index > 1) {
        console.log(val, "val");
        reqUrls.push(val);
    }
});

//spider
if(spiderDomain) {
    console.log("Crawling...".red);
    var spider =  uriManager(spiderDomain);
    var que = [];

    var crawler = Crawler.crawl(spider);
    crawler.interval = 500;

    crawler.on("fetchcomplete",function(queueItem){
        console.log("Spider Completed fetching resource:".yellow,queueItem.url);
    });
}

console.log(spider, "spider");
//process urls
if(typeof reqUrls && reqUrls.length > 0){
    var sendDownPipe = reqUrls.map(uriManager);
    var recersivePipe = require("./lib/recersivePipe")
    recersivePipe(sendDownPipe)
}

