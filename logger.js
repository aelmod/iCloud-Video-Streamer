import chalk from 'chalk';

const _error = chalk.bold.red;
const _warning = chalk.bold.yellow;
const _debug = chalk.green;

const time = () => {
    const date = new Date();
    return `[${date.toLocaleDateString()} ${date.toLocaleTimeString()}]`;
};

export const error = (...args) => {
    console.debug(_error(time(), ...args));
};

export const warning = (...args) => {
    console.debug(_warning(time(), ...args));
};

export const debug = (...args) => {
    console.debug(_debug(time(), ...args));
};
