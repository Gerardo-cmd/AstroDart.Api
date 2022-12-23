/**
 * Will update the user's checklist in the database.
 * @param {*} dynamodb 
 * @param {*} email 
 * @param {*} checklist 
 * @returns A promise to get a string containing the result.
 */
const updateUserChecklist = async (dynamodb, email, checklist) => {
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
    UpdateExpression: "set Checklist = :x",
    ExpressionAttributeValues: {
      ":x": { "M": checklist }
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

export default updateUserChecklist;