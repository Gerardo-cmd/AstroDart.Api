/**
 * Will return the data for one item/account of any type (?). This is should mainly be used for depository accounts and credit card accounts.
 * @param {*} client PlaidApi
 * @param {*} accessToken String
 * @returns A promise to get an array of transactions (objects) on the item/account. Is in reverse chronological order.
 */
const getItemTransactions = async (client, accessToken, getPreviousMonth = false) => {
  const date = new Date();
  let year = date.getFullYear().toString();
  let month = date.getMonth() + 1 < 10 ? '0' + (date.getMonth() + 1).toString() : (date.getMonth() + 1).toString();
  const day = date.getDate() < 10 ? '0' + date.getDate().toString() : date.getDate().toString();

  // If we are in January, then go back to December of the previous year
  let currentMonth = month;
  let currentYear = year;
  if (getPreviousMonth) {
    if (month === "1") {
      month = "12";
      year = parseInt(year) - 1;
      year = year.toString();
    }
    else {
      month = parseInt(month) - 1;
      month = month.toString();
    }
  }

  let request = {
    access_token: accessToken,
    start_date: `${year}-${month}-01`,
    end_date: `${currentYear}-${currentMonth}-${day}`
  };

  try {
    const response = await client.transactionsGet(request);
    let transactions = response.data.transactions;
    const total_transactions = response.data.total_transactions;
    // Manipulate the offset parameter to paginate transactions and retrieve all available data
    while (transactions.length < total_transactions) {
      const paginatedRequest= {
        access_token: accessToken,
        start_date: `${year}-${month}-01`,
        end_date: `${currentYear}-${currentMonth}-${day}`,
        options: {
          offset: transactions.length,
        },
      };
      const paginatedResponse = await client.transactionsGet(paginatedRequest);
      transactions = transactions.concat(
        paginatedResponse.data.transactions,
      );
    }
    return transactions;
  } catch (error) {
    throw new Error(error);
  }
};

export default getItemTransactions;