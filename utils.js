export const getAccountsArray = (newItems) => {
  const accountsArray = [];

  if (!newItems || Object.keys(newItems).length === 0) {
    return accountsArray;
  }

  const itemKeys = Object.keys(newItems);
  
  itemKeys.forEach((itemId) => {
    const accountKeys = Object.keys(newItems[itemId]?.M?.accounts?.M);

    accountKeys.forEach((accountId) => {
      accountsArray.push(newItems[itemId].M.accounts.M[accountId]?.M);
    });
  });

  return accountsArray;
};