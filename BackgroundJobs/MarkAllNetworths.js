import { getAccountsArray } from "../utils.js";

const markAllNetworths = async (dynamodb) => {
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
      if (account.type.S === "credit" || account.type.S === "loan") {
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

export default markAllNetworths;