
var expect = require("chai").expect;
var index = require("../index");

describe("this file takes argv and looks for flags then calls methods accordingly", function(){

   describe("get write stream with -d flag", function(){
       it("process.argv after -d flag", function(){
           var urls = ["google.com", "-d", "./temp"]
           expect(destination).to.have.a.property("temp");
       });
    });

    /* spider not added yet
   describe("get  with -rl flag", function(){
       it("start spider function with -rl flag", function(){
           var urls = ["-rl", "http://google.com"]
           expect().to.have.a.property("./temp/");
       });
    });
    */

});
