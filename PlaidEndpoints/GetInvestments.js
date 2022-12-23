/**
 * Will return the data for one investment item/account.This is mainly for investment accounts.
 * @param {*} client PlaidApi
 * @param {*} accessToken String
 * @returns A promise to get an object containing data on the item/account
 */
const getInvestments = async (client, accessToken) => {
  try {
    const response = await client.investmentsHoldingsGet({
      access_token: accessToken
    });
    const holdings = response.data;
    return holdings;
  } catch (error) {
    throw new Error(error);
  }
  
};

export default getInvestments;