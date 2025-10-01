const config = require('./config.json');
const axios = require('axios');
const crypto = require('crypto');

const API_KEY = process.env.DOMINGO_AS_DEZ_API_KEY || config.domingo_as_dez_api_key;
const UUID = crypto.randomUUID();

console.log(`Using UUID: ${UUID}`)

const sendScoreAsync = async (gameId, homeScore, awayScore, finished) => {
    console.log(`Sending score ${homeScore}-${awayScore} for game ${gameId} finished: ${finished} to domingo às dez`)
    console.log(`POST (${getScoreReportUrl(gameId)})`)
    return new Promise((resolve, reject) => {
        axios.post(
            getScoreReportUrl(gameId),
            {
                user_id: null,
                source: 'afpb_crawler',
                home_score: homeScore,
                ip_address: null,
                user_agent: 'axios 1.6.2, AFPB Score Crawler from Domnigo às Dez',
                away_score: awayScore,
                latitude: null,
                longitude: null,
                accuracy: null,
                uuid: UUID,
                finished: finished,
            },
            {
                headers: {
                    'content-type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                }
            }
        ).then(() => {
            console.log(`Sent score ${homeScore}-${awayScore} for game ${gameId} finished(${finished}) to domingo às dez successfully`)
            resolve(true)
        }).catch(error => {
            if (error.response) {
                reject(`HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`)
              } else if (error.request) {
                reject(`Error on Request: ${JSON.stringify(error.request)}`)
              } else {
                reject(`${error.message}`)
              }
            
            reject(error)
        })
    });
}

const getLiveGamesAsync = async () => {
    console.log(`Getting live games from Domingo às Dez`)
    console.log(`GET (${getLiveGamesUrl()})`)
    const allgames = []
    const response = await axios.get(getLiveGamesUrl(), {});
    if (response.status !== 200) {
        console.log(`Error getting live games from Domingo às Dez, endpoint returned http status ${response.status}`)
        return []
    }

    return response.data.data;
}

const getScoreReportUrl = (gameId) => {
    const env = process.env.NODE_ENV || 'dev'
    if (env === 'prod' || env === 'production') {
        return `https://domingoasdez.com/api/score-reports/${gameId}`
    } else {
        return `http://127.0.0.1:8000/api/score-reports/${gameId}`
    }
}

const getLiveGamesUrl = () => {
    const env = process.env.NODE_ENV || 'dev'
    if (env === 'prod' || env === 'production') {
        return 'https://domingoasdez.com/api/games/live'
    } else {
        return 'http://127.0.0.1:8000/api/games/live'
    }
}

module.exports = {
    sendScoreAsync,
    getLiveGamesAsync
};
