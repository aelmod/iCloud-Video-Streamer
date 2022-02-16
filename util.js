export const getFileId = function (url) {
    return url.split('/').pop().split('#')[0]
};

export const isEmpty = function (str) {
    return (!str || str.length === 0);
};

export const isValidHttpUrl = function (string) {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
};

export const getRange = function (rangeHeader, size) {
    let [start, end] = rangeHeader.replace(/bytes=/, "").split("-");
    start = parseInt(start, 10);
    end = end ? parseInt(end, 10) : size - 1;

    if (!isNaN(start) && isNaN(end)) {
        end = size - 1;
    }
    if (isNaN(start) && !isNaN(end)) {
        start = size - end;
        end = size - 1;
    }

    return {start: start, end: end}
};

export const getStreamOptions = function (range) {
    return {
        hooks: {
            beforeRequest: [
                options => {
                    options.headers = {...options.headers, Range: range}
                }
            ]
        }
    };
}
