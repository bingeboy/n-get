var expect = require("chai").expect;
var should = require('chai').should();

var chdir = require("../lib/chdir.js");

describe("When a desination is declared, ", function( ) {
       it("it should be written to", function( ) {
           var dir = "../temp/";
           chdir(dir, function(err, doc){
                should.exist(doc)
           })
        });
});
