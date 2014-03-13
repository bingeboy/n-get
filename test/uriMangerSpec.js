var expect = require("chai").expect;
var uriManager = require("../lib/uriManager.js");

describe("uriManage takes array or uri and verifies them and returns", function(){

   describe("#requestUri()", function(){
       it("It Should add a protocal if of http:// if one isn't declared", function(){
           var urls = ["google.com", "http://google.com", "192.168.1.1", "http://192.168.1.1", "https://github.com/bingeboy", "ftp://192.168.1.1"];
           var results = urls.map(uriManager);
            console.log(results);
           //expect(results).to.have.a.property("http://google.com");
       });
    });
});
