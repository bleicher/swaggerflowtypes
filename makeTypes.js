#! /usr/bin/env node

var Q = require('q');
var _ = require('underscore');
_.mixin(require('underscore.deep'));

var cliArgs = require('command-line-args');
var fs = require('fs');
var path = require('path');
var request = require('request');

     // var typeName = "TESTType";
     // console.log('wrote to dir:' + options.output);
     // var outPath = path.join('C:\\Users\\Bleicherm\\Desktop\\types', typeName + '.js');
     // console.log('try writing to: ' + outPath);
     // var outputBody = '/* @flow */\n' + "typeBody" + '\nmodule.exports = ' + typeName + ';\n';
     // fs.writeFileSync(outPath, outputBody);
     // console.log('wrote to: ' + outPath);


var get = function(url, dataCallback) {
  request(url, function (error, response, body) {
    if (error) {
        console.log("Could not read url "+url);
        console.log("************************************************** error");
        console.log(error);
        return;
    };
    if (response.statusCode != 200) {
        console.log("Url "+url+" didn't return 200 but "+response.statusCode);
        console.log("************************************************** response");
        console.log(response);
        console.log("************************************************** body");
        console.log(body);
        return;
    };
    dataCallback(JSON.parse(body));
  });
};

var getAPIModels = function(apiJson) {
  return Q.all(_(apiJson.definitions).mapObject(function(apiDef, apiName) {
    var o = {};
    o[apiName] = apiDef;
    apiDef.id = apiName;
    return o;
  }));
};

var scalarTypeFunction = function(type) {
  return function() { return type; };
};

// maps schema type to a function that takes a schema
// and returns the string type for the schema.
var jsonSchemaTypeMap = {
  // 'A JSON array.'
  'array': function(array, possibleImports) {
    return 'Array<' + jsonSchemaToFlowObject(array.items, possibleImports) + '>';
  },
  // 'A JSON object.'
  'object': function(object, possibleImports) {
    return _(object.additionalProperties, possibleImports)
      .chain()
      .map(function(value, key) {
        if (key === 'type') {
          // special handling for string-to-value mapping
          return ['[key: string]', jsonSchemaTypeMap[value.type||'object'](value, possibleImports)];
        }
		if (key === '$ref' && isModelRef(value)) {
          return ['[key: string]', extractModelNameFromRef(value)];
        } else {
          console.error( "don't know how to handle object with additionalProperties key '" + key + "'.");
          throw "don't know how to handle object with additionalProperties key '" + key + "'."
        }
		if (key==='additionalProperties') {
		  return ['[key: string]', jsonSchemaToFlowObject(object.additionalProperties, possibleImports)];
		}
        console.log( "don't know how to handle object with additionalProperties key '" + key + "' and value '"+value+"'.");
		return ['[key: string]', {}]; //let's keep it simple ..., don't know if flow can do more than attaching {}
//          console.error( "don't know how to handle object with additionalProperties key '" + key + "'.");
//          throw "don't know how to handle object with additionalProperties key '" + key + "'."
      })
      .object();
  },
  'boolean': scalarTypeFunction('boolean'),
  'integer': scalarTypeFunction('number'),
  'number': scalarTypeFunction('number'),
  'null': scalarTypeFunction('void'),
  'string': scalarTypeFunction('string')
};

var isModelRef = function(ref) {
  return ref.startsWith('#/definitions/')
};

var extractModelNameFromRef = function(ref) {
  return ref.substring(14);
};

// returns the string type for the given schema;
var jsonSchemaToFlowObject = function(schema, possibleImports) {
  var typeFn, result;

  // return ref if it's used and ok
  if ('$ref' in schema && isModelRef(schema.$ref)) {
    var modelName = extractModelNameFromRef(schema.$ref);
    if (_(possibleImports).contains(modelName)) {
      result = modelName;
    } else {
      throw new Error('invalid schema:' + JSON.stringify(schema), 'no such type available: ' + schema.$ref);
      console.log('invalid schema:' + JSON.stringify(schema), 'no such type available: ' + schema.$ref);
      return 'any';
    }
  }

  // otherwise serialize type. Default to object if schema.type is not specified.
  else if ((typeFn = jsonSchemaTypeMap[schema.type || 'object'])) {
    result = typeFn(schema, possibleImports);
  }

  else {
    throw new Error('invalid schema:' + JSON.stringify(schema));
  }

  return result;
};

var outputAPI = function(modelSets) {

  var possibleImports = _(modelSets)
    .chain()
    .map(function(modelSet) {
      return _(modelSet).map(function(value, key) { return key; });
    })
    .flatten()
    .value();

  var counter = 0;

  var models = _(modelSets)
    .chain()
    .map(function(modelSet) {
      return _(modelSet)
        .chain()
        .values()
        .map(function(model) {
          console.info( 'model: ', model );
          // now we're dealing with the actual model
          var typeObject = _(model.properties)
            .chain()
            .map(function(schema, key) {
              return [key, jsonSchemaToFlowObject(schema, possibleImports)];
            })
            .object()
            .value();
//          if (model.id == 'BettyArticle') {
//            console.log('now dealing with BettyArticle');
//            console.info( 'typeObject %d %s: ', ++counter, model.id, typeObject );
//          }
		  console.log("***************************"+model.id);
		  console.log(JSON.stringify(typeObject));
		  console.log(typeObject);
          var classDefinition = JSON.stringify(typeObject)
            .replace(/\{/, '{\n  ')
            .replace(/,/g, ';\n  ')
            .replace(/:/g, ': ')
            .replace(/"/g, '')
            .replace(/}$/g, ';\n}');
          var imports = _(_.deepToFlat(model))
            .chain()
            .filter(function(value, key) {
              return /\$ref$/.test(key) &&
                  isModelRef(value) &&
                  _(possibleImports).contains(extractModelNameFromRef(value));
            })
            .map(function(name) {
              var modelName = isModelRef(name) ? extractModelNameFromRef(name) : name;
              return 'var ' + modelName + " = require('./" + modelName + "');\n";
            })
            .unique()
            .value()
            .join('');

          var result = imports + '\nclass ' + model.id + ' ' + classDefinition;
		  console.log(result);
		  return result;
        })
        .value();
    })
    .flatten()
    .each(function(typeBody) {
      console.log('*************************************** writing');
      console.log(typeBody);
      var typeName = typeBody.match(/class ([^ ]*) {/)[1];
      var outPath = path.join(options.output, typeName + '.js');
      var outputBody = '/* @flow */\n' + typeBody + '\nmodule.exports = ' + typeName + ';\n';
      fs.writeFileSync(outPath, outputBody);
      console.log('wrote to ' + outPath);
    })
    .value();
};

/* define the command-line options */
var cli = cliArgs([
  { name: 'swaggerUrl', type: String, defaultOption: true, description: 'url of your swagger api docs' },
  { name: 'output', type: String, alias: 'o', description: 'directory to place output files' },
  { name: 'help', type: Boolean, description: 'Print usage instructions' },
]);

var options = cli.parse();

if (options.help) {
  var usage = cli.getUsage({
    header: 'Flow type class definitions from Swagger API JSON.',
    footer: 'For more information, visit https://github.com/jackphel/swaggerflowtypes'
  });
  console.log(usage);
} else {
  get(options.swaggerUrl, function (data) {
    getAPIModels(data).then(outputAPI).catch(function(err) {
      console.error(err);
    });
  });
}
