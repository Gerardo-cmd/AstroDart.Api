import env from "dotenv";
import jsSHA from "jssha";
import jwt from "jsonwebtoken";

const createUser = async (dynamodb, email, password, firstName, lastName) => {
  try {
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

    if (Object.keys(item).length !== 0) {
      return "Duplicate Account";
    }

    const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
    const hashedPassword = shaObj.update(password).getHash("HEX");
    const putParams = {
      TableName: 'AstroDart.Users',
      Item: {
        "UserId": { "S": email },
        "FirstName": { "S": firstName },
        "LastName": { "S": lastName },
        "Password": { "S": hashedPassword },
        "Checklist": { "M": {} },
        "LinkedItems": { "M": {} },
        "NetworthHistory": { "M": {} }, 
        "MonthlySpending": { "M": {} } 
      }
    };

    const successful = await dynamodb.putItem(putParams, (err, data) => {
      if (err) {
        console.error("Error encountered:", err);
        return false;
      } else {
        return true;
      }
    }).promise();

    if (!successful) {
      throw new Error("Error when creating the account!");
    }
    else {
      const token = jwt.sign(email, process.env.SECRET);
      const data = {
        "data": {
          token, 
          firstName, 
          lastName, 
          checklist: {}, 
          items: {}, 
          networthHistory: {}, 
          monthlySpending: {} 
        }
      };
      return data;
    }
  } catch (error) {
    throw new Error(error);
  }
};

export default createUser;