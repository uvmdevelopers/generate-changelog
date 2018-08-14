'use strict';

var Bluebird = require('bluebird');
var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
var DEFAULT_TYPE = 'other';
var PR_REGEX = new RegExp(/#[1-9][\d]*/g);
var fs = require('fs');
var path = require('path');

/**
 * Generate the commit URL for the repository provider.
 * @param {String} baseUrl - The base URL for the project
 * @param {String} commitHash - The commit hash being linked
 * @return {String} The URL pointing to the commit
 */
exports.getCommitUrl = function (baseUrl, commitHash) {
  var urlCommitName = 'commit';

  if (baseUrl.indexOf('bitbucket') !== -1) {
    urlCommitName = 'commits';
  }

  if (baseUrl.indexOf('gitlab') !== -1 && baseUrl.slice(-4) === '.git') {
    baseUrl = baseUrl.slice(0, -4);
  }

  return baseUrl + '/' + urlCommitName + '/' + commitHash;
};

function CSVToArray( strData, strDelimiter ){
    // Check to see if the delimiter is defined. If not,
    // then default to comma.
    strDelimiter = (strDelimiter || ",");

    // Create a regular expression to parse the CSV values.
    var objPattern = new RegExp(
        (
            // Delimiters.
            "(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +

            // Quoted fields.
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +

            // Standard fields.
            "([^\"\\" + strDelimiter + "\\r\\n]*))"
        ),
        "gi"
    );

    // Create an array to hold our data. Give the array
    // a default empty first row.
    var arrData = [[]];

    // Create an array to hold our individual pattern
    // matching groups.
    var arrMatches = null;

    // Keep looping over the regular expression matches
    // until we can no longer find a match.
    while (arrMatches = objPattern.exec( strData )){
        // Get the delimiter that was found.
        var strMatchedDelimiter = arrMatches[ 1 ];

        // Check to see if the given delimiter has a length
        // (is not the start of string) and if it matches
        // field delimiter. If id does not, then we know
        // that this delimiter is a row delimiter.
        if (
            strMatchedDelimiter.length &&
            strMatchedDelimiter !== strDelimiter
        ){
            // Since we have reached a new row of data,
            // add an empty row to our data array.
            arrData.push( [] );
        }

        var strMatchedValue;

        // Now that we have our delimiter out of the way,
        // let's check to see which kind of value we
        // captured (quoted or unquoted).
        if (arrMatches[ 2 ]){
            // We found a quoted value. When we capture
            // this value, unescape any double quotes.
            strMatchedValue = arrMatches[ 2 ].replace(
                new RegExp( "\"\"", "g" ),
                "\""
            );
        } else {
            // We found a non-quoted value.
            strMatchedValue = arrMatches[ 3 ];
        }

        // Now that we have our value string, let's add
        // it to the data array.
        arrData[ arrData.length - 1 ].push( strMatchedValue );
    }
    // Return the parsed data.
    return( arrData );
}

function getFullName(item,index) {
    var newArray = {};
    newArray[item[0]] = item[1];
    return newArray;
}

/**
 * Generate the markdown for the changelog.
 * @param {String} version - the new version affiliated to this changelog
 * @param {Array<Object>} commits - array of parsed commit objects
 * @param {Object} options - generation options
 * @param {Boolean} options.patch - whether it should be a patch changelog
 * @param {Boolean} options.minor - whether it should be a minor changelog
 * @param {Boolean} options.major - whether it should be a major changelog
 * @param {String} options.repoUrl - repo URL that will be used when linking commits
 * @returns {Promise<String>} the \n separated changelog string
 */
exports.markdown = function (version, commits, options) {
  var csvTypes;
  var allTypes;
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
      if (this.readyState === 4 && this.status === 200) {
          csvTypes = CSVToArray(this.responseText, ';');
          csvTypes = csvTypes.map(getFullName);
          var types = {};
          csvTypes.forEach(function(element) {
              if (Object.keys(element)[0] !== '')
              {
                  allTypes = Object.assign({},allTypes, element);
              }
          });
      }
  };

  var config = JSON.parse(fs.readFileSync(path.join(__dirname, '../urls.json'), 'utf8'));
  xhttp.open("GET", config.typesUrl, false);
  xhttp.send();

  var content = [];
  var date = new Date().toJSON().slice(0, 10);
  var heading;

  if (options.major) {
    heading = '##';
  } else if (options.minor) {
    heading = '###';
  } else {
    heading = '####';
  }

  if (version) {
    heading += ' ' + version + ' (' + date + ')';
  } else {
    heading += ' ' + date;
  }

  content.push(heading);
  content.push('');

  return Bluebird.resolve(commits)
  .bind({ types: {} })
  .each(function (commit) {
    var type = allTypes[commit.type] ? commit.type : DEFAULT_TYPE;
    var category = commit.category;

    this.types[type] = this.types[type] || {};
    this.types[type][category] = this.types[type][category] || [];

    this.types[type][category].push(commit);
  })
  .then(function () {
    return Object.keys(this.types).sort();
  })
  .each(function (type) {
    var types = this.types;

    content.push('##### ' + allTypes[type]);
    content.push('');

    Object.keys(this.types[type]).forEach(function (category) {
      var prefix = '*';
      var nested = types[type][category].length > 1;
      var categoryHeading = prefix + (category ? ' **' + category + ':**' : '');

      if (nested && category) {
        content.push(categoryHeading);
        prefix = '  *';
      } else {
        prefix = categoryHeading;
      }

      types[type][category].forEach(function (commit) {
        var body = commit.body;
        var breakingChange = body.match(/BREAKING CHANGE: (.*?)*/);
        var closes = body.match(/Closes #(.*?)*/);
        var shorthash = commit.hash.substring(0, 8);
        var subject = commit.subject;

        if (options.repoUrl) {
          shorthash = '[' + shorthash + '](' + exports.getCommitUrl(options.repoUrl, commit.hash) + ')';

          subject = subject.replace(PR_REGEX, function (pr) {
            return '[' + pr + '](' + options.repoUrl + '/pull/' + pr.slice(1) + ')';
          });
        }
        var breakingChangeLine = '';
        var closesLine = '';

        if (breakingChange)
        {
            breakingChange = breakingChange[0].replace('BREAKING CHANGE: ', '');
            breakingChange = breakingChange.replace('\n', '');
            breakingChangeLine = '\n\t* breaking changes: ' + breakingChange;
        }

        if (closes)
        {
            closes = closes[0].replace('Closes #', '');
            closes = closes.replace('\n', '');
            closesLine = '(' + closes + ')';
        }

        content.push(prefix + ' ' + subject + ' (' + shorthash + ') ' + closesLine + breakingChangeLine);
      });
    });

    content.push('');
  })
  .then(function () {
    content.push('');
    return content.join('\n');
  });
};
