#n-get

Goal to create a node flavored Wget.
Git version now allows for multiple file downloads ***WARNING ALPHA BUILD WITH KNOWN ISSUES***


### How To Install
```
$npm install n-get -g 

or from the git repo:
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

### Example 
```




* If no protocal is used in the file path http will be used by default
* If no writePath is provided http will be used by default


Pull requests welcome. Use at your own risk.


Licence: MIT
