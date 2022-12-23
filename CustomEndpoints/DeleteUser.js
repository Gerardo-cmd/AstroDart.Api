import env from "dotenv";
import jsSHA from "jssha";

const deleteUser = async (dynamodb, email, password) => {
  const getParams = {
    TableName: "AstroDart.Users",
    Key: {
      "UserId": {
        "S": email
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

  if (Object.keys(item).length === 0) {
    return "Error getting account";
  }

  const shaObj = new jsSHA("SHA-512", "TEXT", { encoding: "UTF8" });
  const hashedPassword = shaObj.update(password).getHash("HEX");
  const deleteParams = {
    TableName: 'AstroDart.Users',
    Key: {
      "UserId": {"S": email}
    }
  };

  if (hashedPassword !== item.Item.Password.S) {
    return "Invalid Credentials";
  }
  
  const successful = await dynamodb.deleteItem(deleteParams, (err, data) => {
    if (err) {
      throw new Error(err);
    } else {
      return true;
    }
  }).promise();

  if (!successful) {
    return "Error deleting account";
  }

  return successful;
};

export default deleteUser;