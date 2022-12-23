/**
 * Will update the user's items in the database.
 * @param {*} dynamodb 
 * @param {*} email 
 * @param {*} items 
 * @returns A promise to get a string containing the result.
 */
const updateUserItems = async (dynamodb, email, items) => {
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
      console.error("Error when getting user:", err);
      return undefined;
    } else {
      return data.Item;
    }
  }).promise();

  if (Object.keys(item).length === 0) {
    return "Account not found";
  }

  const updateParams = {
    TableName: 'AstroDart.Users',
    Key: {
      "UserId": {"S": email}
    },
    UpdateExpression: "set LinkedItems = :x",
    ExpressionAttributeValues: {
      ":x": { "M": items }
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

  if (!successful) {
    return "Failed";
  }
  else {
    return "Successful";
  }
};

export default updateUserItems;