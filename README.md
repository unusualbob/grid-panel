Grid Panel
==========
Grid Panel is an open source minecraft admin control panel. It is currently in development and not yet ready for production.

##Developer Installation##
These instruction assume you are on Ubuntu, please feel to contribute instructions for other operating systems.

`sudo apt-get build-essential`

#####Build and install node.js
````
(cd to wherever you would like to keep node's source)
git clone https://github.com/joyent/node.git
cd node
git checkout v0.8.23 (this may work on other versions of node, but this is the only one I have tested)
./configure
make
sudo make install
````

Fork our project: https://github.com/unusualbob/grid-panel/fork

#####Clone FROM YOUR FORK

```
(cd to wherever you want this panel)
git clone git@github.com:YOUR_GITHUB_USERNAME/grid-panel.git
```

#####Install dependencies
````
cd grid-panel
npm install
````

#####Setup your config file
```
cp config.js.example config.js
nano config.js
```

Then run your panel `node app.js`

The default credentials to access this panel are `admin`:`password`.
