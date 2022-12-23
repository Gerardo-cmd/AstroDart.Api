/**
 * Will return the data for one depository item/account. This is mainly for cash accounts.
 * @param {*} client PlaidApi
 * @param {*} accessToken String
 * @returns A promise to get an object containing data on the item/account
 */
const getAuth = async (client, accessToken) => {
  try {
    const response = await client.authGet({
      access_token: accessToken,
    });
    const data = response.data;
    return data;
  } catch (error) {
    throw new Error(error);
  }
};

export default getAuth;