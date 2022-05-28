import React from "https://dev.jspm.io/react";
//class for client side cache in browser, and all relevant methods
import BrowserCache from "../src/Browser/CacheClassBrowser.js";
//inserts __typename meta fields into query string. Other methods in file are helpers
import { insertTypenames } from "../src/Browser/insertTypenames.js";

//using context to pass props; React context allows props to be shared between components without drilling
const cacheContext = React.createContext();


function ObsidianWrapper(props) {
  //create new instance of CacheClassBrowser as defined in separate file
  //using hooks for cache state management
  //contect wrapper with dev tool using chrome Extension ID
  //create cache item stored in browser (persists across sessions...allegedly)
  const [cache, setCache] = React.useState(new BrowserCache());

  // You have to put your Google Chrome Obsidian developer tool extension id to connect Obsidian Wrapper with dev tool
  const chromeExtensionId = "bcncopcfepkndfcnfbphnknngpaobplp";

  window.localStorage.setItem("cache", JSON.stringify(cache));

  //ObsidianWrapper has 3 methods: query, hunt and mutate. 

  //Query method can be configured in multiple ways.
    //first, it sends the query itself and the cache to the dev tool
    //then the query is sent to the cache and executed based on the inputted options
    //it dynamically measures latency using Date.now for both cache miss and cache hit
    //either readThru or writeThru (or both) depending on settings
    //returns promise that resolves with either the response object or a call to hunt if there's a cache miss

  //Hunt is invoked on a cache miss, or if query is sent in timed intervals
    //sends query in fetch request body
    //caches query if cacheWrite is set to true
    //return resObj or console logs error

  //Mutate changes cached queries
  async function query(query, options = {}) {
    // dev tool messages
    const startTime = Date.now();
    //sendmessage sends single message to event listeners. It's sent to the chrome extension here, along w the query
    chrome.runtime.sendMessage(chromeExtensionId, { query: query });
    //another message is sent, this time containing the client side cache
    chrome.runtime.sendMessage(chromeExtensionId, {
      cache: window.localStorage.getItem("cache"),
    });
    console.log(
      "Here's the message content: ",
      window.localStorage.getItem("cache")
    );
    // set the options object default properties if not provided

    //default settings for options object:

      //endPoint: specifies browser input to which fetches will be sent
      //cacheRead: when true, query will be searched for in cache
      //cacheWrite: when true, query will be written to cache
      //pollInterval: user can set query to be sent repeatedly every inputted # of milliseconds. If null it will be sent once
      //wholeQuery: Whether or not user wants to pass the entire query and receive unfiltered results (?)
    const {
      endpoint = "/graphql",
      cacheRead = true,
      cacheWrite = true,
      pollInterval = null,
      wholeQuery = false,
    } = options;

    // when pollInterval is not null the query will be sent to the server every inputted number of milliseconds
    //no interval is set by default
    if (pollInterval) {
      const interval = setInterval(() => {
        // pass in query() with options instead
        new Promise((resolve, reject) =>
          resolve(//why is cacheRead being set to false...? for efficiency?
            query(query, { pollInterval: null, cacheRead: false, ...options })
          )
        );
      }, pollInterval);
      return interval;
    }

    // when cacheRead set to true, cache will be checked for query. One of two method invoked depending on whether wholequery is being utilized
    if (cacheRead) {
      let resObj;
      // when the developer decides to only utilize whole query for cache
      //read whole query defined in cache class file
      if (wholeQuery) resObj = await cache.readWholeQuery(query);
      else resObj = await cache.read(query);
      console.log("query function resObj: ", resObj);
      // check if query is stored in cache
      //if query is found in cache, record latency and send to chrome
      if (resObj) {
        // returning cached response as a promise
        const cacheHitResponseTime = Date.now() - startTime;
        chrome.runtime.sendMessage(chromeExtensionId, {
          cacheHitResponseTime: cacheHitResponseTime,
        });
        //return promise for resolving resObj (what does that even mean)
        return new Promise((resolve, reject) => resolve(resObj));
      }
      // execute graphql fetch request if cache miss
      return new Promise((resolve, reject) => resolve(hunt(query)));
      // when cacheRead set to false
    }
    if (!cacheRead) {
      return new Promise((resolve, reject) => resolve(hunt(query)));
    }

    // when cache miss or on intervals
    async function hunt(query) {
      //insert schema-defined typenames into query string to make it parseable
      if (!wholeQuery) query = insertTypenames(query);
      try {
        // send fetch request with query
        const resJSON = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query }),
        });
        const resObj = await resJSON.json();
        //deep copy of res object
        const deepResObj = { ...resObj };
        // update result in cache if cacheWrite is set to true
        //why
        if (cacheWrite) {
          if (wholeQuery) cache.writeWholeQuery(query, deepResObj);
          else cache.write(query, deepResObj);
        }

        //latency for cache miss
        const cacheMissResponseTime = Date.now() - startTime;
        chrome.runtime.sendMessage(chromeExtensionId, {
          cacheMissResponseTime: cacheMissResponseTime,
        });
        console.log(
          "Here's the response time on the front end: ",
          cacheMissResponseTime
        );
        return resObj;
      } catch (e) {
        console.log(e);
      }
    }
  }

  // Function to clear cache and session storage
  function clearCache() {
    cache.cacheClear();
  }

  // breaking out writethrough logic vs. non-writethrough logic
  async function mutate(mutation, options = {}) {
    // dev tool messages
    chrome.runtime.sendMessage(chromeExtensionId, {
      mutation: mutation,
    });
    const startTime = Date.now();
    mutation = insertTypenames(mutation);
    //has unique options:
      //toDelete:
      //update:
      //writeThru:
    const {
      endpoint = "/graphql",
      cacheWrite = true,
      toDelete = false,
      update = null,
      writeThrough = false,
    } = options;
    try {
      if (writeThrough) {
        // if it's a deletion, then delete from cache and return the object
        if (toDelete) {
          const responseObj = await cache.writeThrough(
            mutation, //query string
            {}, //response obj
            true, //delete?
            endpoint //endpoint
          );
          const deleteMutationResponseTime = Date.now() - startTime;
          chrome.runtime.sendMessage(chromeExtensionId, {
            deleteMutationResponseTime: deleteMutationResponseTime,
          });
          return responseObj;
        } else {
          // for add mutation
          const responseObj = await cache.writeThrough(
            mutation,
            {},
            false,
            endpoint
          );
          // for update mutation
          if (update) {
            // run the update function
            update(cache, responseObj);
          }
          // always write/over-write to cache (add/update)
          // GQL call to make changes and synchronize database
          console.log("WriteThrough - true ", responseObj);
          const addOrUpdateMutationResponseTime = Date.now() - startTime;
          chrome.runtime.sendMessage(chromeExtensionId, {
            addOrUpdateMutationResponseTime: addOrUpdateMutationResponseTime,
          });
          return responseObj;
        }
      } else {
        // copy-paste mutate logic from 4.

        // use cache.write instead of cache.writeThrough
        const responseObj = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query: mutation }),
        }).then((resp) => resp.json());
        if (!cacheWrite) return responseObj;
        // first behaviour when delete cache is set to true
        if (toDelete) {
          cache.write(mutation, responseObj, true);
          return responseObj;
        }
        // second behaviour if update function provided
        if (update) {
          update(cache, responseObj);
        }
        // third behaviour just for normal update (no-delete, no update function)
        cache.write(mutation, responseObj);
        console.log("WriteThrough - false ", responseObj);
        return responseObj;
      }
    } catch (e) {
      console.log(e);
    }
  }
  // Returning Provider React component that allows consuming components to subscribe to context changes
  return (
    <cacheContext.Provider
      value={{ cache, setCache, query, clearCache, mutate }}
      {...props}
    />
  );
}
// Declaration of custom hook to allow access to provider
function useObsidian() {
  // React useContext hook to access the global provider by any of the consumed components
  return React.useContext(cacheContext);
}

// Exporting of Custom wrapper and hook to access wrapper cache
export { ObsidianWrapper, useObsidian };
