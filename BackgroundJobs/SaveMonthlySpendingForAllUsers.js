const saveMonthlySpendingForAllUsers = async (dynamodb, client) => {
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
          // We don't want negative transactions That doesn't count as spending
          if (amount > 0) {
            categoriesObject[category] = { "M": {
              "Amount": { "N": amount.toString()},
              "Category": { "S": category } 
            }};
            total += amount;
          }
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

export default saveMonthlySpendingForAllUsers;
