import getItemTransactions from './GetItemTransactions.js';
import { getAccountsArray } from "../utils.js";

/**
 * Will return all of the user's transactions across all linked cash and credit accounts for either the current month or the previous month
 * @param {*} dynamodb AWS.DynamoDB
 * @param {*} client PlaidApi
 * @param {*} email string
 * @param {*} previousMonth boolean (defaults to false)
 * @returns A promise to get an array of all transactions as described above
 */
const getAllTransactionsForUser = async (dynamodb, client, email, previousMonth = false) => {
  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: email
      }
    }
  };
  
  const item = await dynamodb.getItem(getParams, (err, data) => {
    if (err) {
      console.error("Error when getting item:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  const linkedItems = item.Item.LinkedItems.M;
  const promiseArray = [];
  const itemKeys = Object.keys(linkedItems);
  itemKeys.forEach((itemKey) => {
    const accessToken = linkedItems[itemKey].M.access_token.S;
    if (linkedItems[itemKey].M.product.S === "auth" || linkedItems[itemKey].M.product.S === "liabilities") {
      promiseArray.push(new Promise(async (resolve, reject) => {
        try {
          const transactions = await getItemTransactions(client, accessToken, previousMonth);
          resolve(transactions);
        } catch (error) {
          console.error("Error occured when getting the transactions. The error is below.");
          console.error(error);
        }
      }));
    }
  });

  const transactionsData = (await Promise.all(promiseArray)).flat();
  // Go through all of transactions. If the account Id is not in the user's data or it's a credit card payment, then remove it from the data array
  const accountsArray = getAccountsArray(linkedItems);
  const accountKeys = [];
  let userHasCreditAccount = false;
  accountsArray.forEach((account) => {
    switch (account.type.S) {
      case 'credit':
        userHasCreditAccount = true;
      case 'depository':
        accountKeys.push(account.accountId.S);
        break;
    }
  });
  const filteredTransactionsData = transactionsData.filter((transaction) => {
    return userHasCreditAccount ? accountKeys.includes(transaction.account_id) && !transaction.category.includes("Credit Card") : accountKeys.includes(transaction.account_id);
  });
  const finalTransactionsData = filteredTransactionsData.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return finalTransactionsData;
};

export default getAllTransactionsForUser;