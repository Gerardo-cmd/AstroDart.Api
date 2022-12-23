import express from 'express';
import cors from 'cors';

import AWS from 'aws-sdk';
import env from "dotenv";
import {
  Configuration,
  PlaidApi,
  Products,
  PlaidEnvironments, 
} from "plaid";
import cron from "node-cron";

/** Plaid Endpoint Imports */
import getAuth from './PlaidEndpoints/GetAuth.js';
import getBalance from './PlaidEndpoints/GetBalance.js';
import getInvestments from './PlaidEndpoints/GetInvestments.js';
import getLiabilities from './PlaidEndpoints/GetLiabilities.js';
import getAllTransactionsForUser from './PlaidEndpoints/GetAllTransactionsForUser.js';

/** Custom Endpoint Imports */
import login from './CustomEndpoints/Login.js';
import createUser from './CustomEndpoints/CreateUser.js';
import deleteUser from './CustomEndpoints/DeleteUser.js';
import updateUserChecklist from './CustomEndpoints/UpdateUserChecklist.js';
import updateUserItems from './CustomEndpoints/UpdateUserItems.js';

import { getAccountsArray } from "./utils.js";

const app = express();

// Load in .ENV file contents
env.config();

// Use express's body parser for post requests
app.use(express.json());

// Activate cors
app.use(cors({
    origin: ['http://localhost:3000'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET, POST', 'PUT', 'DELETE'],
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

const saveMonthlySpendingForAllUsers = async () => {
  const date = new Date();
  const params = {
    TableName: "AstroDart.Users",
  };
  const users = [];
  let items;

  do{
    items = await dynamodb.scan(params).promise();
    items.Items.forEach((item) => users.push(item));
    params.ExclusiveStartKey  = items.LastEvaluatedKey;
  }while(typeof items.LastEvaluatedKey !== "undefined");

  const userPromiseArray = [];
  users.map((user) => {
    const email = user.UserId.S;
    userPromiseArray.push(new Promise(async (resolve, reject) => {
      try {
        const getParams = {
          TableName: "AstroDart.Users",
          Key: {
            "UserId": {
              S: email
            }
          }
        };
        
        const userItem = await dynamodb.getItem(getParams, (err, data) => {
          if (err) {
            console.error("Error when getting user:", err);
            return undefined;
          } else {
            return data.Item;
          }
        }).promise();

        // Remember to get the data from the previous month
        const transactions = await getAllTransactionsForUser(dynamodb, client, email, true);
        // Sum up transactions to get total for each category as well as total overall
        const categoriesObject = {};
        const categories = new Map();

        transactions.forEach((transaction) => {
          const category = transaction.category[0] === "Payment" && transaction.category.length > 1 ? transaction.category[1] : transaction.category[0]
          if (categories.has(category))  {
            const oldValue = categories.get(category);
            categories.set(category, oldValue + transaction.amount);
          }
          else {
            categories.set(category, transaction.amount);
          }
        });
      
        let total = 0;
        categories.forEach((amount, category) => {
          categoriesObject[category] = { "M": {
            "Amount": { "N": amount.toString()},
            "Category": { "S": category } 
          }};
          total += amount;
        });
        categoriesObject["Overall"] = { "N": total.toString() };

        // Save data in the database
        const monthlySpendingKeys = Object.keys(userItem.Item.MonthlySpending?.M);
        
        let newMonthlySpending;
        // We only want the previous two months, so if we have already have two, 
        // then create the new one while getting rid of the oldest one
        if (monthlySpendingKeys.length === 2) {
          newMonthlySpending = {};
          newMonthlySpending["0"] = userItem.Item.MonthlySpending.M["1"];
          // Remember that we are using last month's data
          newMonthlySpending["1"] = {
            "M": {
              "Date": { "S": (date.getMonth()) + "-" + date.getFullYear() },
              "Spending": { 
                "M": categoriesObject 
              }
            }
          };
        }
        // If there is 1 month or no data recorded
        else {
          newMonthlySpending = userItem.Item.MonthlySpending.M;
          // Remember that we are using last month's data
          newMonthlySpending[monthlySpendingKeys.length.toString()] = {
            "M": {
              "Date": { "S": (date.getMonth()) + "-" + date.getFullYear() },
              "Spending": { 
                "M": categoriesObject 
              }
            } 
          };
        }

        const updateParams = {
          TableName: 'AstroDart.Users',
          Key: {
            "UserId": {"S": email}
          },
          UpdateExpression: "set MonthlySpending = :x",
          ExpressionAttributeValues: {
            ":x": { 
              "M": newMonthlySpending 
            }
          }
        };
      
        const successful = await dynamodb.updateItem(updateParams, (err, data) => {
          if (err) {
            console.error("Error encountered:", err);
            return false;
          } else {
            return true;
          }
        }).promise();
        resolve(successful);
      } catch (error) {
        console.error("There was an error when getting the transactions for one user. The error is below.");
        console.error(error);
      }
    }));
  });

  Promise.all(userPromiseArray).then((results) => {
    console.log("Successfully saved monthly spending totals for all users");
  }).catch((error) => {
    console.error("Something went wrong when saving monthly spending amounts for all users. None were saved as a result. The error is below");
    console.error(error);
  });
};

const updateAllBalances = async () => {
  // Go through every user
  const params = {
    TableName: "AstroDart.Users",
  };

  const userPromiseArray = [];
  const users = [];
  let items;

  do{
    items =  await dynamodb.scan(params).promise();
    items.Items.forEach((item) => users.push(item));
    params.ExclusiveStartKey  = items.LastEvaluatedKey;
  }while(typeof items.LastEvaluatedKey !== "undefined");

  // Go through every item
  users.map((user) => {
    const userId = user.UserId.S;
    const itemPromiseArray = [];
    const itemKeys = Object.keys(user.LinkedItems.M);

    const newItems = user.LinkedItems.M;

    itemKeys.forEach((item) => {
      // Call the api/balance/get endpoint below to get the latest balances
      const accessToken = user.LinkedItems.M[item].M.access_token.S;
      const accountKeys = Object.keys(user.LinkedItems.M[item].M.accounts.M);
      const itemId = user.LinkedItems.M[item].M.item_id.S;
      const institutionId = user.LinkedItems.M[item].M.institution_id.S;
      const product = user.LinkedItems.M[item].M.product.S;

      itemPromiseArray.push(new Promise(async (resolve, reject) => {
        const request = {
          access_token: accessToken,
        };
        const response = await client.accountsBalanceGet(request);
        const accounts = response.data.accounts;

        const getParams = {
          TableName: "AstroDart.Users",
          Key: {
            "UserId": {
              S: userId
            }
          }
        };

        const accountsForThisItem = {};
        accounts.forEach((account) => {
          // Only copy the current balance if it exists in the user's data. Otherwise, skip over it
          if (accountKeys.includes(account.account_id)) {
            accountsForThisItem[account.account_id] = {
              M: {
                accountId: { S: account.account_id},
                name: { S: account.name},
                balance: { N: account.balances.current.toString()},
                item_id: { S: itemId },
                type: { S: account.type}
              }
            };
          }
        });

        // Update the value with the new accounts but keep everything else tha same
        newItems[itemId] = {
          M: {
            institution_id: { S: institutionId },
            access_token: { S: accessToken },
            item_id: { S: itemId },
            accounts: { M: accountsForThisItem },
            product: { S: product }
          }
        };
        const updateParams = {
          TableName: 'AstroDart.Users',
          Key: {
            "UserId": { "S": userId }
          },
          UpdateExpression: "set LinkedItems = :x",
          ExpressionAttributeValues: {
            ":x": { "M": newItems }
          }
        };
      
        const successful = await dynamodb.updateItem(updateParams, (err, data) => {
          if (err) {
            console.error("Error encountered:", err);
            return false;
          } else {
            return true;
          }
        }).promise();
  
        resolve(successful);
      }));
    });

    userPromiseArray.push(itemPromiseArray);
  });

  for (let index = 0; index < userPromiseArray.length; index++) {
    // Iterate over every user
    const promiseArray = userPromiseArray[index];
    // Complete the promise array for the current user
    Promise.all(promiseArray).then((results) => {
      console.log("Successfully updated all balances for one user")
    }).catch((error) => {
      console.error("Something went wrong when updating all balances. None were updated as a result. The error is below");
      console.error(error);
    });
  }
};

const getNetworth = async () => {
  const date = new Date();
  const params = {
    TableName: "AstroDart.Users",
  };
  const promiseArray = [];
  const users = [];
  let items;

  do{
    items = await dynamodb.scan(params).promise();
    items.Items.forEach((item) => users.push(item));
    params.ExclusiveStartKey  = items.LastEvaluatedKey;
  }while(typeof items.LastEvaluatedKey !== "undefined");

  users.map((user) => {
    let currentNetworth = 0;
    const items = user.LinkedItems?.M;

    // Will return an empty array if there are no items
    const accountsArray = getAccountsArray(items);
    accountsArray.forEach((account) => {
      let accountBalance = parseFloat(account.balance.N);
      if (account.type.S === "credit") {
        accountBalance *= -1;
      }
      currentNetworth += accountBalance;
    });

    promiseArray.push(new Promise(async (resolve, reject) => {
      const getParams = {
        TableName: "AstroDart.Users",
        Key: {
          "UserId": {
            S: user.UserId.S
          }
        }
      };
      
      const userItem = await dynamodb.getItem(getParams, (err, data) => {
        if (err) {
          console.error("Error when getting user:", err);
          return undefined;
        } else {
          return data.Item;
        }
      }).promise();

      const networthHistoryKeys = Object.keys(userItem.Item.NetworthHistory?.M);
      const newNetworthHistory = userItem.Item.NetworthHistory.M;
      newNetworthHistory[networthHistoryKeys.length.toString()] = {
        "M": {
          "Date": { "S": (date.getMonth() + 1) + "-" + date.getFullYear() },
          "Networth": { "N": Math.floor(currentNetworth).toString() }
        } 
      };

      const updateParams = {
        TableName: 'AstroDart.Users',
        Key: {
          "UserId": {"S": user.UserId.S}
        },
        UpdateExpression: "set NetworthHistory = :x",
        ExpressionAttributeValues: {
          ":x": { 
            "M": newNetworthHistory
          }
        }
      };
    
      const successful = await dynamodb.updateItem(updateParams, (err, data) => {
        if (err) {
          console.error("Error encountered:", err);
          return false;
        } else {
          return true;
        }
      }).promise();

      resolve(successful);
    }));
  });

  Promise.all(promiseArray).then((results) => {
    console.log(`Successfully updated all user's networths!`);
  })
  .catch((error) => {
    console.error("Something went wrong when saving the networth of each user. As a result, none were saved. The error is below.");
    console.log(error);
  });
};

cron.schedule('0 9 1 * *', () => {
  console.log('Marking all users\'s networth At 09:00 AM on the first day of every month');
  getNetworth();
});

cron.schedule('0 8,17 * * *', () => {
  console.log('Updating all balances At 08:00 AM and 5:00 PM every day');
  updateAllBalances();
});

// Read whole table, read each user once, and write to each user once Change this to reade the data from last month!
cron.schedule('0 1 1 * *', () => {
  console.log('Marking all users\'s spending for the previous month At 01:00 AM on the first day of every month');
  saveMonthlySpendingForAllUsers();
});

app.get('/api/info', function (req, res) {
  res.status(200).send({
    item_id: ITEM_ID,
    access_token: ACCESS_TOKEN,
    products: process.env.PLAID_PRODUCTS,
  });
});

// Creates a link token in oder to initialize Plaid Link client-side. Ideally used every log in.
app.post('/api/create_link_token', (req, res, next) => {
  if (!req.body.userToken || !req.body.type) {
    res.status(400).send({
      "msg": "Need to provide the userToken"
    });
    return;
  }

  Promise.resolve()
    .then(async () => {
      const products = [req.body.type];
      if (req.body.type === "auth" || req.body.type === "liabilities") {
        products.push('transactions');
      }
      const configs = {
        user: {
          // This should correspond to a unique id for the current user.
          client_user_id: req.body.userToken,
        },
        client_name: 'AstroDart Sandbox',
        products: products,
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
      res.status(200).send(
        createTokenResponse.data
      );
    })
    .catch((error) => {
      console.error("Here is the error below!");
      console.error(error)
      next(error);
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

/** Plaid Endpoints */
// Retrieve data on an item's accounts. 
app.post('/api/auth', async (req, res) => {
  try {
    const data = await getAuth(client, req.body.accessToken);
    res.status(200).send(data);
    return;
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/api/balance', async (req, res) => {
  if (!req.body.accessToken) {
    res.status(400).send({
      "msg": "Need accessToken"
    });
    return;
  }
    try {
      const accounts = await getBalance(client, req.body.acccessToken);
      res.status(200).send(accounts);
    } catch (error) {
      res.status(500).send(error);
    }
}); 

// Get transactions for all accounts that are depository or credit
app.post('/api/transactions', async (req, res) => {
  if (!req.body.email) {
    res.status(400).send({
      "msg": "Need email"
    });
  }
  try {
    const transactions = await getAllTransactionsForUser(dynamodb, client, req.body.email, false);
    res.status(200).send(transactions);
    return;
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const response = await client.categoriesGet({});
    const categories = response.data.categories;
    res.status(200).send(categories);
  } catch (error) {
    res.status(500).send(error);
  }
})

app.post('/api/liabilities', async (req, res) => {
  if (!req.body.accessToken) {
    res.status(400).send({
      "msg": "Need accessToken"
    });
    return;
  }
  try {
    const liabilities = await getLiabilities(client, req.body.accessToken);
    res.status(200).send(liabilities);
    return;
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/api/investments', async (req, res) => {
  if (!req.body.accessToken) {
    res.status(400).send({
      "msg": "Need accessToken"
    });
    return;
  }
  try {
    const invetments = await getInvestments(client, req.body.accessToken);
    res.status(200).send(invetments);
    return;
  } catch (error) {
    res.status(500).send(error)
  }
});

/** Custom Endpoints */
// An endpoint for logging in and verifying credentials
app.post("/api/login", async (req, res) => {
  if (!req.body.email || !req.body.password) {
    res.status(400).send({
      "msg": "Need email and password"
    });
  }
  try {
    const data = await login(dynamodb, req.body.email, req.body.password);
    if (data === "Invalid Credentials") {
      res.status(200).send({
        "msg": "Invalid Credentials"
      });
      return;
    }
    res.status(200).send(data);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      "msg": "Something went wrong in the server when trying to login. Please try again later."
    });
  }
});

// An endpoint for creating new users
app.put('/api/user', async (req, res) => {
  if (!req.body.email || !req.body.password || !req.body.firstName || !req.body.lastName) {
    res.status(400).send({
      "msg": "Must include email, password, firstName, and lastName"
    });
    return;
  }

  try {
    const data = await createUser(dynamodb, req.body.email, req.body.password, req.body.firstName, req.body.lastName);
    if (data === "Duplicate Account") {
      res.status(200).send({
        "msg": "There is already an account with this email"
      });
      return;
    }

    res.status(200).send(data);
  } catch (error) {
    res.status(500).send({
      "msg": "Something went wrong in the server. Error: " + error
    });
  }
});


// An endpoint for deleting users
app.delete('/api/user', async (req, res) => {
  if (!req.body.email || !req.body.password) {
    res.status(400).send({
      "msg": "Must include email and password!"
    });
    return;
  }
  try {
    const data = await deleteUser(dynamodb, req.body.email, req.body.password);
    if (data === "Error getting account") {
      res.status(500).send({
        "msg": "There was an error in the server when trying to pull up the account. Please try again later."
      });
      return;
    }
    else if (data === "Invalid Credentials") {
      res.status(200).send({
        "msg": "Invalid credentials"
      });
      return;
    }
    else if (data === "Error deleting account") {
      res.status(500).send({
        "msg": "There was an error in the server when trying to delete your account from the database. Please try again later."
      });
      return;
    }
    else if (data) {
      res.status(200).send({
        "msg": "Account deleted"
      });
      return;
    }
    else {
      throw new Error("Something weird happened");
    }
  } catch (error) {
    res.status(500).send({
      "msg": "Something went wrong in the server. " + error
    });
  }
});

// An endpoint for updating a user's checklist
app.post('/api/checklist', async (req, res) => {
  if (!req.body.email || !req.body.checklist) {
    res.status(400).send({
      "msg": "Must include email and checklist"
    });
    return;
  }
  try {
    const data = await updateUserChecklist(dynamodb, req.body.email, req.body.checklist);
    if (data === "Account not found") {
      res.status(500).send({
        "msg": "There was an error in the server when bringing up your account. Please try again later."
      });
      return;
    }
    else if (data === "Failed") {
      res.status(500).send({
        "msg": "There was an error in the server when trying to update your checklist. Please try again later."
      });
      return;
    }
    else if (data === "Successful") {
      res.status(200).send({
        "msg": "Updated checklist successfully"
      });
      return;
    }
    throw new Error("An unexpected outcome occurred when updating a user's checklist");
  } catch (error) {
    res.status(500).send({
      "msg": "There was an unexpected error in the server. " + error
    });
  }
});

// An endpoint for updating a user's items
app.post('/api/items', async (req, res) => {
  if (!req.body.email || !req.body.items) {
    res.status(400).send({
      "msg": "Must include email and items"
    });
    return;
  }

  try {
    const data = await updateUserItems(dynamodb, req.body.email, req.body.items);
    if (data === "Account not found") {
      res.status(500).send({
        "msg": "There was an error in the server when bringing up your account. Please try again later."
      });
      return;
    }
    else if (data === "Failed") {
      res.status(500).send({
        "msg": "There was an error in the server when trying to update your items. Please try again later."
      });
      return;
    }
    else if (data === "Successful") {
      res.status(200).send({
        "msg": "Updated items successfully"
      });
      return;
    }
  } catch (error) {
    res.status(500).send({
      "msg": "There was an unexpected error in the server. " + error
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
