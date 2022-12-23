import jsSHA from "jssha";
import jwt from "jsonwebtoken";

/**
 * Will verify the credentials given to authorize login.
 * @param {*} dynamodb AWS.DynamoDB
 * @param {*} email String
 * @param {*} password String
 * @returns A promise to get either a string containing the result or an object with the respective data if the action was successful.
 */
const login = async (dynamodb, email, password) => {
  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        S: email
      }
    }
  };

  try {
    const item = await dynamodb.getItem(getParams, (err, data) => {
      if (err) {
        console.error("Error when getting item for login:", err);
        return undefined;
      } else {
        return data.Item;
      }
    }).promise();
  
    if (Object.keys(item).length === 0) {
      return "Invalid Credentials";
    }
  
    const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
    const hashedPassword = shaObj.update(password).getHash("HEX");
  
    if (hashedPassword !== item.Item.Password.S) {
      return "Invalid Credentials";
    }
    const token = jwt.sign(email, process.env.SECRET);
    const data = {
      data: {
        token,
        firstName: item.Item.FirstName?.S,
        lastName: item.Item.LastName?.S,
        checklist: item.Item.Checklist?.M,
        items: item.Item.LinkedItems?.M || {},
        networthHistory: item.Item.NetworthHistory?.M || {}, 
        monthlySpending: item.Item.MonthlySpending?.M || {} 
      }
    }
    return data;
  } catch (error) {
    throw new Error(error);
  }
};

export default login;