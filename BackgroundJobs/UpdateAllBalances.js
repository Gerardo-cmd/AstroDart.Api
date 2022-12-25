const updateAllBalances = async (dynamodb, client) => {
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

export default updateAllBalances;