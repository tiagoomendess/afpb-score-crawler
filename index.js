const cheerio = require('cheerio')
const axios = require('axios')
const fs = require('fs')
const domingoAsDezClient = require('./domingoasdez')
const afpb = require('./afpb')

const ACTIVE_SLEEP_TIME_SECONDS = 30
const INACTIVE_SLEEP_TIME_SECONDS = 600 // 10 minutes
const SENT_CACHE_FILE_NAME = 'sent_results_cache.txt'
const sent_cache = []

let isActive = true

const loop = async () => {
    console.log('Starting the scraper...')

    loadSentCache()
    
    while (true) {
        console.log('=== Running Crawler =====================')

        console.log(`Running in ${process.env.NODE_ENV || 'dev'} environment`)

        try {
            await run()
        } catch (error) {
            console.error('Major error that could not be recovered:\n', error?.message)
        }
        
        const sleepingTime = isActive ? ACTIVE_SLEEP_TIME_SECONDS : INACTIVE_SLEEP_TIME_SECONDS
        console.log(`=== Sleeping for ${sleepingTime} seconds =============\n\n\n`)
        await new Promise(resolve => setTimeout(resolve, sleepingTime*1000))
    }
}

const run = async () => {
    const liveGames = await domingoAsDezClient.getLiveGamesAsync()
    if (!liveGames || liveGames.length === 0) {
        console.log('No live games found, skipping run')
        isActive = false
        return
    }

    isActive = true

    // Log the amount of groups and how many games per group
    console.log(`Got ${liveGames.length} game groups from Domingo às Dez`)
    for (const gameGroup of liveGames) {
        console.log(`Group ${gameGroup.competition_name} ${gameGroup.game_group_name} ${gameGroup.season_name}: ${gameGroup.games.length} games`)
    }

    const games = []
    for (const gameGroup of liveGames) {
        console.log(`Processing group ${gameGroup.competition_name} ${gameGroup.season_name}`)
        const groupGames = await afpb.handleGroup(gameGroup)
        games.push(...groupGames)
    }

    console.log(`Found ${games.length} games in total from all groups`)

    console.log(`Starting to process games`)

    games.forEach(async (game) => {
        const finKey = game.finished ? 'finished' : 'not finished'

        if (game.homeScore === null || game.awayScore === null) {
            console.log(`Skipping ${game.homeTeam} - ${game.awayTeam} (${finKey}) because score is null`)
            return
        }

        const gameStringId = `${game.homeTeam} ${game.homeScore}-${game.awayScore} ${game.awayTeam} (${finKey})`
        const cacheKey = generateCacheKey(game)
        if (sent_cache.includes(cacheKey)) {
            console.log(`Skipping ${gameStringId} because it was already sent`)
            return
        }

        const matchedLiveGame = liveGames.find(liveGame => {
            return liveGame.homeTeam === game.homeTeam && liveGame.awayTeam === game.awayTeam
        })

        if (!matchedLiveGame) {
            console.log(`Skipping ${gameStringId} because it was not found in live games`)
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

const generateCacheKey = (game) => {
    return `${game.date}_${game.homeTeam}_${game.awayTeam}_${game.homeScore}_${game.awayScore}_${game.finished}`
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

loop()
