const cheerio = require('cheerio')
const axios = require('axios')
const fs = require('fs')
const domingoAsDezClient = require('./domingoasdez')
const config = require('./config.json')

const SENT_CACHE_FILE_NAME = 'sent_results_cache.txt'
const sent_cache = []

const loop = async () => {
    console.log('Starting the scraper...')

    loadSentCache()
    
    // Make the request
    while (true) {
        console.log('=== Running Crawler =====================')

        try {
            await run()
        } catch (error) {
            console.error('Major error running crawler that could not be recovered:\n', error?.message)
        }
        
        console.log('=== Sleeping for 60 seconds =============\n\n\n')
        await new Promise(resolve => setTimeout(resolve, 60000))
    }
}

const run = async () => {
    const liveGames = await domingoAsDezClient.getLiveGamesAsync()
    /*if (!liveGames || liveGames.length === 0) {
        console.log('No live games found, skipping run')
        return
    }*/

    console.log('Making request to https://afpbarcelos.pt/')
    const games = []
    const response = await axios.get('https://afpbarcelos.pt/')
    if (response.status !== 200) {
        console.log(`Error making request, page returned http status ${response.status}`)
        return
    } else {
        console.log('Request successful')
    }

    const $ = cheerio.load(response.data)
    $('.match-list > .game').each((i, element) => {
        const homeTeam = $(element).find('.list-1 p').text().trim()
        const awayTeam = $(element).find('.list-3 p').text().trim()

        const middleSection = $(element).find('.list-2 td')
        let score = null
        let date = null
        let finished = false
        $(middleSection).find('span').each((i, element) => {
            const value = $(element).text().trim()

            let matches = value.match(/^\d+\s?\-\s?\d+$/g)
            if (matches) {
                score = matches[0]
                score = score.replace(/\s/g, '')
            }

            matches = value.match(/^\d{2}-\d{2}-\d{4}\s\-\s\d{2}:\d{2}$/g)
            if (matches) {
                date = parseDate(matches[0])
            }

            matches = value.match(/^Terminado$/g)
            if (matches) {
                finished = true
            }
        })

        games.push({
            homeTeam: mapClubName(homeTeam),
            awayTeam: mapClubName(awayTeam),
            homeScore: score ? score.split('-')[0] : null,
            awayScore: score ? score.split('-')[1] : null,
            finished: finished,
            date: date ? formatDate(date) : null
        })
    })

    games.forEach(async (game) => {
        const finKey = game.finished ? 'finished' : 'not finished'
        console.log(`Processing game ${game.homeTeam} vs ${game.awayTeam} (${finKey})`)

        if (game.homeScore === null || game.awayScore === null) {
            console.log(`Skipping ${game.homeTeam} - ${game.awayTeam} (${finKey}) because score is null`)
            return
        }

        const gameStringId = `${game.homeTeam} ${game.homeScore}-${game.awayScore} ${game.awayTeam} (${finKey})`
        const cacheKey = generateCacheKey(game.homeTeam, game.awayTeam, game.homeScore, game.awayScore, game.finished)
        if (sent_cache.includes(cacheKey)) {
            console.log(`Not processing ${gameStringId} because it was already sent`)
            return
        }

        const matchedLiveGame = liveGames.find(liveGame => {
            return liveGame.homeTeam === game.homeTeam && liveGame.awayTeam === game.awayTeam
        })

        if (!matchedLiveGame) {
            console.log(`Ignoring ${gameStringId} because it was not found in live games`)
            return
        }

        if (matchedLiveGame.finished) {
            console.log(`Skipping ${gameStringId} because it is already finished on Domingo às Dez`)
            return
        }

        try {
            await domingoAsDezClient.sendScoreAsync(matchedLiveGame.id, game.homeScore, game.awayScore, game.finished)
            addToSentCache(cacheKey)
        } catch (error) {
            console.error(`Error sending score for ${gameStringId}: `, error)
        }
    })

    await new Promise(resolve => setTimeout(resolve, 2000))
}

const generateCacheKey = (homeTeam, awayTeam, homeScore, awayScore, finished) => {
    return `${homeTeam}_${awayTeam}_${homeScore}_${awayScore}_${finished}`
}

const addToSentCache = (key) => {
    sent_cache.push(key)
    fs.appendFileSync(SENT_CACHE_FILE_NAME, `${key}\r\n`)
}

const loadSentCache = () => {
    console.log('Reading sent cache file')
    try {
        const lines = fs.readFileSync(SENT_CACHE_FILE_NAME).toString().split("\r\n");

        lines.forEach(line => {
            sent_cache.push(line)
        })

        console.log(`Sent cache file loaded ${lines.length} lines into memory`)
    } catch (error) {
        console.log('Error loading sent cache file')
    }
}

const mapClubName = (name) => {
    if (!config.club_names_map) {
        console.log('No club names map found in config')
        return name
    }

    const map = config.club_names_map
    const length = map.length
    for (let i = 0; i < length; i++) {
        if (map[i].from === name) {
            return map[i].to
        }
    }

    console.log(`No mapping found for club ${name}`)

    return name
}

const formatDate = (date) => {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2)
    const day = ('0' + date.getDate()).slice(-2)
    const hours = ('0' + date.getHours()).slice(-2)
    const minutes = ('0' + date.getMinutes()).slice(-2)

    return `${year}-${month}-${day} ${hours}:${minutes}:00`
}

const parseDate = (dateString) => {
    let components = dateString.match(/(\d{2})-(\d{2})-(\d{4})\s\-\s(\d{2}):(\d{2})/);

    if (components) {
        let day = parseInt(components[1], 10);
        let month = parseInt(components[2], 10) - 1; // Months are 0-indexed
        let year = parseInt(components[3], 10);
        let hours = parseInt(components[4], 10);
        let minutes = parseInt(components[5], 10);

        let parsedDate = new Date(year, month, day, hours, minutes);

        // Check if the Date object is valid
        if (!isNaN(parsedDate.getTime())) {
            return parsedDate;
        } else {
            return null;
        }
    } else {
        return null;
    }
}

loop()
