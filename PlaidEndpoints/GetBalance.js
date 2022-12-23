/**
 * Will return the data for one item/account of any type. Mainly used to get the latest and updated balances for an account.
 * @param {*} client PlaidApi
 * @param {*} accessToken String
 * @returns An object containing data on the item/account
 */
const getBalance = async (client, accessToken) => {
  try {
    const response = await client.accountsBalanceGet({
      access_token: accessToken
    });
    const accounts = response.data.accounts;
    return accounts;
  } catch (error) {
    throw new Error(error);
  }
};

export default getBalance;