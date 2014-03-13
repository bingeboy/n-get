#n-get

![nget demo](https://raw.github.com/bingeboy/n-get/master/assets/nget.gif)

Goal to create a node flavored Wget.
Repo version features improved support for:

* Files with query strings
* Mutiple async pipe requests


[![build status](https://secure.travis-ci.org/bingeboy/n-get.png)](http://travis-ci.org/bingeboy/n-get)


### How To Install
```
$npm install n-get -g 
```
Or from the git repo:
```
$git clone https://github.com/bingeboy/n-get
$cd ./n-get 
$npm . install -g
```
### How To Use
Download a single file
```
$nget [protocal]filePath
```
Or download to a specific location:
```
$nget [protocal]filePath -d [WritePath]
```
Even more that one request at a time:
```
$nget [protocal]filePath [protocal]filePath2 [protocal]filePath3 ... -d [WritePath]

```

* If no protocal is used in the file path http will be used by default
* If no writePath is provided current location will be used by default


Pull requests welcome. Use at your own risk.


Licence: MIT
