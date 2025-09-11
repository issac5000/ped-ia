export const LENGTH_FOR_AGE = (() => {
  const data = {
    0: { P3: 46.3, P15: 47.8, P50: 49.9, P85: 51.8, P97: 53.2 },
    1: { P3: 50.5, P15: 52.0, P50: 54.7, P85: 56.7, P97: 58.1 },
  };
  for (let m = 2; m <= 60; m++) {
    data[m] = { P3: null, P15: null, P50: null, P85: null, P97: null }; // TODO: compléter avec les valeurs OMS
  }
  return data;
})();

export const WEIGHT_FOR_AGE = (() => {
  const data = {
    0: { P3: 2.5, P15: 2.9, P50: 3.3, P85: 3.8, P97: 4.2 },
    1: { P3: 3.4, P15: 3.7, P50: 4.5, P85: 5.3, P97: 5.8 },
  };
  for (let m = 2; m <= 60; m++) {
    data[m] = { P3: null, P15: null, P50: null, P85: null, P97: null }; // TODO: compléter avec les valeurs OMS
  }
  return data;
})();

export const BMI_FOR_AGE = (() => {
  const data = {
    0: { P3: 11.7, P15: 12.4, P50: 13.3, P85: 14.4, P97: 14.8 },
    1: { P3: 13.8, P15: 14.4, P50: 15.4, P85: 16.6, P97: 17.2 },
  };
  for (let m = 2; m <= 60; m++) {
    data[m] = { P3: null, P15: null, P50: null, P85: null, P97: null }; // TODO: compléter avec les valeurs OMS
  }
  return data;
})();
