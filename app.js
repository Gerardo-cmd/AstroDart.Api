import express from 'express';
import cors from 'cors';

import AWS from 'aws-sdk';
import jsSHA from "jssha";
import jwt from "jsonwebtoken";
import env from "dotenv";
import {
  Configuration,
  PlaidApi,
  Products,
  PlaidEnvironments
} from "plaid";

const app = express();

// Load in .ENV file contents
env.config();

// Use express's body parser for post requests
app.use(express.json());

// Activate cors
app.use(cors({
    origin: ['http://localhost:3000'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET, POST', 'DELETE'],
    optionsSuccessStatus: 200
}));

const dynamodb = new AWS.DynamoDB({
  region: "us-east-1"
});

let ITEM_ID = null;
let ACCESS_TOKEN = null;
let PUBLIC_TOKEN = null;

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

// PLAID_PRODUCTS is a comma-separated list of products to use when initializing
// Link. Note that this list must contain 'assets' in order for the app to be
// able to create and retrieve asset reports.
const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || Products.Transactions).split(
  ',',
);
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || 'US').split(
  ',',
);
const PLAID_REDIRECT_URI = process.env.PLAID_REDIRECT_URI || '';
const PLAID_ANDROID_PACKAGE_NAME = process.env.PLAID_ANDROID_PACKAGE_NAME || '';

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
      'Plaid-Version': '2020-09-14',
    },
  },
});

const client = new PlaidApi(configuration);

app.get('/api/info', function (req, res) {
  res.status(200).send({
    "data": {
      item_id: ITEM_ID,
      access_token: ACCESS_TOKEN,
      products: process.env.PLAID_PRODUCTS,
    }
  });
});

// Creates a link token in oder to initialize Plaid Link client-side. Ideally used every log in.
app.post('/api/create_link_token', (req, res, next) => {
  if (!req.body.userToken) {
    res.status(400).send({
      "msg": "Need to provide the userToken"
    });
    return;
  }

  Promise.resolve()
    .then(async () => {
      const configs = {
        user: {
          // This should correspond to a unique id for the current user.
          client_user_id: req.body.userToken,
        },
        client_name: 'AstroDart Sandbox',
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: 'en',
      };

      if (process.env.PLAID_REDIRECT_URI !== '') {
        configs.redirect_uri = PLAID_REDIRECT_URI;
      }

      if (process.env.PLAID_ANDROID_PACKAGE_NAME !== '') {
        configs.android_package_name = PLAID_ANDROID_PACKAGE_NAME;
      }
      const createTokenResponse = await client.linkTokenCreate(configs);
      res.status(200).send({
        "data": createTokenResponse.data
      });
    })
    .catch((error) => {
      console.log("Here is the error below!");
      console.log(error)
      next();
    });
});

// Exchange a Link public_token for a new item's access_token
app.post('/api/set_access_token', (req, res, next) => {
  if (!req.body.public_token) {
    res.status(400).send({
      "msg": "Must include public token!"
    });
    return;
  }
  Promise.resolve()
    .then(async () => {
      const tokenResponse = await client.itemPublicTokenExchange({
        public_token: req.body.public_token,
      });
      ACCESS_TOKEN = tokenResponse.data.access_token;
      ITEM_ID = tokenResponse.data.item_id;
      if (PLAID_PRODUCTS.includes(Products.Transfer)) {
        TRANSFER_ID = await authorizeAndCreateTransfer(ACCESS_TOKEN);
      }
      res.status(200).send({
        access_token: ACCESS_TOKEN,
        item_id: ITEM_ID,
        error: null,
      });
    })
    .catch(next);
});


// Retrieve data on an item's accounts
app.post('/api/auth', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const authResponse = await client.authGet({
        access_token: req.body.accessToken || ACCESS_TOKEN,
      });
      res.status(200).send(authResponse.data);
    })
    .catch(next);
});

// Uses DynamoDB
// An endpoint for logging in and verifying credentials
app.post("/api/login", async (req, res) => {
  if (!req.body.email || !req.body.password) {
    res.status(400).send({
      "msg": "Need email and password"
    });
  }
  
  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: req.body.email
      }
    }
  };
  
  const item = await dynamodb.getItem(getParams, (err, data) => {
    if (err) {
      console.log("Error when getting item:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  if (Object.keys(item).length === 0) {
    res.status(200).send({
      "msg": "There is not an account registered with this email!"
    });
    return;
  }

  const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
  const hashedPassword = shaObj.update(req.body.password).getHash("HEX");

  if (hashedPassword !== item.Item.Password.S) {
    res.status(200).send({
      "msg": "Incorrect Password"
    });
  }
  else {
    const token = jwt.sign(req.body.email, process.env.SECRET);
    res.status(200).send({
      "data": {
        token,
        firstName: item.Item.FirstName?.S,
        lastName: item.Item.LastName?.S,
        checklist: item.Item.Checklist?.M,
        items: item.Item.LinkedItems?.M,
      }
    });
  }
});

// Uses DynamoDB
// An endpoint for creating new users
app.post('/api/new-user', async (req, res) => {
  if (!req.body.email || !req.body.password || !req.body.firstName || !req.body.lastName) {
    res.status(400).send({
      "msg": "Must include all necessary info!"
    });
    return;
  }

  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: req.body.email
      }
    }
  };
  
  const item = await dynamodb.getItem(getParams, (err, data) => {
    if (err) {
      console.log("Error when getting item:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  if (Object.keys(item).length !== 0) {
    res.status(200).send({
      "msg": "There is already an accont registered with this email!"
    });
    return;
  }

  const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
  const hashedPassword = shaObj.update(req.body.password).getHash("HEX");
  const putParams = {
    TableName: 'AstroDart.Users',
    Item: {
      "UserId": {"S": req.body.email},
      "FirstName": {"S": req.body.firstName},
      "LastName": {"S": req.body.lastName},
      "Password": {"S": hashedPassword},
      "Checklist": {"M": {}},
      "LinkedItems": {"M": {}}
    }
  };

  const successful = await dynamodb.putItem(putParams, (err, data) => {
    if (err) {
      console.log("Error encountered:", err);
      return false;
    } else {
      return true;
    }
  }).promise();

  if (!successful) {
    res.status(500).send({
      "msg": "Error when creating the account!"
    });
  }
  else {
    const token = jwt.sign(req.body.email, process.env.SECRET);
    res.status(200).send({
      "data": {
        token
      }
    });
  }
});

// Uses DynamoDB
// An endpoint for updating the checklist
app.post('/api/checklist', async (req, res) => {
  if (!req.body.email || !req.body.checklist) {
    res.status(400).send({
      "msg": "Must include all necessary the email and checklist"
    });
    return;
  }

  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: req.body.email
      }
    }
  };
  
  const item = await dynamodb.getItem(getParams, (err, data) => {
    if (err) {
      console.log("Error when getting user:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  if (Object.keys(item).length === 0) {
    res.status(200).send({
      "msg": "There is already an accont registered with this email!"
    });
    return;
  }

  const updateParams = {
    TableName: 'AstroDart.Users',
    Key: {
      "UserId": {"S": req.body.email}
    },
    UpdateExpression: "set Checklist = :x",
    ExpressionAttributeValues: {
      ":x": { "M": req.body.checklist }
    }
  };

  const successful = await dynamodb.updateItem(updateParams, (err, data) => {
    if (err) {
      console.log("Error encountered:", err);
      return false;
    } else {
      return true;
    }
  }).promise();

  if (!successful) {
    res.status(500).send({
      "msg": "Error while updating the checklist!"
    });
  }
  else {
    res.status(200).send({
      "msg": "Checklist update successful"
    });
  }
});

// Uses DynamoDB
// An endpoint for updating the items a user has
app.post('/api/items', async (req, res) => {
  if (!req.body.email || !req.body.items) {
    res.status(400).send({
      "msg": "Must include all necessary the email and items"
    });
    return;
  }

  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: req.body.email
      }
    }
  };
  
  const item = await dynamodb.getItem(getParams, (err, data) => {
    if (err) {
      console.log("Error when getting user:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  if (Object.keys(item).length === 0) {
    res.status(200).send({
      "msg": "There is already an accont registered with this email!"
    });
    return;
  }

  const updateParams = {
    TableName: 'AstroDart.Users',
    Key: {
      "UserId": {"S": req.body.email}
    },
    UpdateExpression: "set LinkedItems = :x",
    ExpressionAttributeValues: {
      ":x": { "M": req.body.items }
    }
  };

  const successful = await dynamodb.updateItem(updateParams, (err, data) => {
    if (err) {
      console.log("Error encountered:", err);
      return false;
    } else {
      return true;
    }
  }).promise();

  if (!successful) {
    res.status(500).send({
      "msg": "Error updating the items!"
    });
  }
  else {
    res.status(200).send({
      "msg": "Items update successful"
    });
  }
});

app.listen(process.env.PORT || 5000, () => console.log("server starting on port 5000!"));

// This is a helper function to authorize and create a Transfer after successful
// exchange of a public_token for an access_token. The TRANSFER_ID is then used
// to obtain the data about that particular Transfer.

const authorizeAndCreateTransfer = async (accessToken) => {
  // We call /accounts/get to obtain first account_id - in production,
  // account_id's should be persisted in a data store and retrieved
  // from there.
  const accountsResponse = await client.accountsGet({
    access_token: accessToken,
  });
  const accountId = accountsResponse.data.accounts[0].account_id;

  const transferAuthorizationResponse =
    await client.transferAuthorizationCreate({
      access_token: accessToken,
      account_id: accountId,
      type: 'credit',
      network: 'ach',
      amount: '1.34',
      ach_class: 'ppd',
      user: {
        legal_name: 'FirstName LastName',
        email_address: 'foobar@email.com',
        address: {
          street: '123 Main St.',
          city: 'San Francisco',
          region: 'CA',
          postal_code: '94053',
          country: 'US',
        },
      },
    });
  const authorizationId = transferAuthorizationResponse.data.authorization.id;

  const transferResponse = await client.transferCreate({
    idempotency_key: '1223abc456xyz7890001',
    access_token: accessToken,
    account_id: accountId,
    authorization_id: authorizationId,
    type: 'credit',
    network: 'ach',
    amount: '12.34',
    description: 'Payment',
    ach_class: 'ppd',
    user: {
      legal_name: 'FirstName LastName',
      email_address: 'foobar@email.com',
      address: {
        street: '123 Main St.',
        city: 'San Francisco',
        region: 'CA',
        postal_code: '94053',
        country: 'US',
      },
    },
  });
  return transferResponse.data.transfer.id;
};

// An endpoint for connecting a user to their bank via credentials
// https://development.plaid.com
// An endpoint for each account balance and storing it in our cache
// An endpoint to get each account balance from cache and calculate total net worth
// An endpoint to get each spending item
// An endpoint to get the checklist of the account as well as whether each item was completed or not

// Database
// A document for each user:
// - A document containing all of the account balances
// - A document containing the checklist (With each item checked or unchecked)
// - A document conatinaing all the spending items over the past period
