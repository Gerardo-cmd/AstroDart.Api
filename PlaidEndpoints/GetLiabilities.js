/**
 * Will return the data for one liability item/account.This is mainly for credit and loan accounts.
 * @param {*} client PlaidApi
 * @param {*} accessToken String
 * @returns An object containing data on the item/account
 */
const getLiabilities = async (client, accessToken) => {
  try {
    const response = await client.liabilitiesGet({
      access_token: accessToken
    });
    const liabilities = response.data;
    return liabilities;
  } catch (error) {
    throw new Error(error);
  }
};

export default getLiabilities;