let counter = 0;
const customAlphabet = (alphabet, size) => () => {
  return 'id' + (counter++) + Math.random().toString(36).substring(7);
};

const nanoid = (size) => {
  return 'id' + (counter++) + Math.random().toString(36).substring(7);
};

module.exports = {
  customAlphabet,
  nanoid,
};
