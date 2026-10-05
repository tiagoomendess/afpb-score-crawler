const axios = require('axios')
const cheerio = require('cheerio')
const config = require('./config.json')

const AFPB_BASE_URL = 'https://afpbarcelos.pt/'

const HONRA_EDITION = 60
const DIV_1_EDITION = 61
const DIV_2_EDITION = 62
const TACA_EDITION = 65
const TACA_FEM_EDITION = 58
const DIV_FEM_EDITION = 64
const SUPERTACA_EDITION = 59
const SUPERTACA_FEM_EDITION = 63

// Domingo às Dez key is `${competition_name} ${game_group_name}`.
const competitionToEdition = {
    "Divisão de Honra Agribar Campeonato": HONRA_EDITION,
    "1ª Divisão Papagaio Loiro Campeonato": DIV_1_EDITION,
    "2ª Divisão Campeonato": DIV_2_EDITION,
    "Taça Cidade de Barcelos Eliminatórias": TACA_EDITION,
    "Taça Cidade de Barcelos Feminino Eliminatórias": TACA_FEM_EDITION,
    "1ª Divisão Feminino Campeonato": DIV_FEM_EDITION,
    "Super Taça AFPB Eliminatórias": SUPERTACA_EDITION,
    "Super Taça Feminina Eliminatórias": SUPERTACA_FEM_EDITION,
}

// Cup phases 1 and 2 are empty on AFPB. 1ª Eliminatória is ordering 3.
const tacaEditions = new Set([TACA_EDITION, TACA_FEM_EDITION])
// Supertaça is a single fixture. Ordering 1 is empty; the match is on ordering 0.
const supertacaEditions = new Set([SUPERTACA_EDITION, SUPERTACA_FEM_EDITION])

const CSS_SELECTORS = {
    GAMES: 'div.games > .overview',
    HOME_TEAM_NAME: '.teams > .home-team > .team-name',
    AWAY_TEAM_NAME: '.teams > .away-team > .team-name',
    HOME_SCORE: '.score-home',
    AWAY_SCORE: '.score-away',
    DATE: 'time',
    WIN: '.teams > .win',
    DETAIL_URL: 'a',
    MATCH_STATUS: '.vanues > div.stadium',
    MATCH_SCORE: '.vanues .score',
    MATCH_DATE: '.vanues .date',
    SIDEBAR_GAMES: '.match-list a',
    SIDEBAR_HOME: '.list-1 p',
    SIDEBAR_AWAY: '.list-3 p',
}

const handleGroup = async (gameGroup) => {
    const edition = competitionToEdition[`${gameGroup.competition_name} ${gameGroup.game_group_name}`]
    if (!edition) {
        console.log(`No edition found for competition ${gameGroup.competition_name} ${gameGroup.game_group_name}`)
        return []
    }

    // The gamegroup has an array of games, but those games can have different rounds, 
    // get all the possible int values for round from all the items inside group.games
    // distinct round values
    const rounds = gameGroup.games.map(game => game.round).filter(round => round !== null).map(round => parseInt(round)).filter((round, index, self) => self.indexOf(round) === index)

    // for each round make one request to a website to scrape and save the results in an array of values
    // The response will be HTML, so we need to use cheerio to parse the response
    const responses = []
    for (const round of rounds) {
        // Turns out ordering can be dephased by the edition
        let ordering = round
        if (tacaEditions.has(edition)) {
            ordering = round + 2
        } else if (supertacaEditions.has(edition)) {
            ordering = 0
        }

        const requestUrl = `https://afpbarcelos.pt/index.php?partial_load=_constructhtmlbyedition&edition=${edition}&ordering=${ordering}`

        console.log(`Requesting ${requestUrl}`)

        // Wait a random time between 500 and 1000ms so we don't overload the server
        const randomTime = Math.floor(Math.random() * 500) + 500
        await new Promise(resolve => setTimeout(resolve, randomTime))

        const response = await axios.get(requestUrl, {
            headers: generateRandomHeaders(),
            timeout: 10000,
            withCredentials: true
        })
        if (response.status !== 200) {
            console.log(`Error making request to ${requestUrl}, status: ${response.status}`)
            continue
        }

        responses.push(response.data)
    }

    const games = []
    for (const response of responses) {
        const $ = cheerio.load(response)
        const standardGames = $(CSS_SELECTORS.GAMES)

        if (standardGames.length > 0) {
            for (const element of standardGames) {
                const homeTeam = $(element).find(CSS_SELECTORS.HOME_TEAM_NAME).text().trim()
                const awayTeam = $(element).find(CSS_SELECTORS.AWAY_TEAM_NAME).text().trim()
                const homeScore = $(element).find(CSS_SELECTORS.HOME_SCORE).text().trim()
                const awayScore = $(element).find(CSS_SELECTORS.AWAY_SCORE).text().trim()
                const dateStr = $(element).find(CSS_SELECTORS.DATE).text().trim()

                let matchDetails = {
                    finished: false,
                }

                // Match Detail URL
                let detailUrl = $(element).find(CSS_SELECTORS.DETAIL_URL).attr('href')
                if (detailUrl) {
                    matchDetails = await fetchMatchDetails(detailUrl)
                }

                const date = parseGameDate(dateStr)

                games.push({
                    homeTeam: mapClubName(homeTeam),
                    awayTeam: mapClubName(awayTeam),
                    homeScore: homeScore ? parseInt(homeScore, 10) : null,
                    awayScore: awayScore ? parseInt(awayScore, 10) : null,
                    finished: matchDetails.finished,
                    date: date.toISOString()
                })
            }
            continue
        }

        // Supertaça fixtures use a sidebar list and only publish the score on the match page.
        for (const element of $(CSS_SELECTORS.SIDEBAR_GAMES)) {
            const homeTeam = $(element).find(CSS_SELECTORS.SIDEBAR_HOME).text().trim()
            const awayTeam = $(element).find(CSS_SELECTORS.SIDEBAR_AWAY).text().trim()
            const detailUrl = $(element).attr('href')
            if (!homeTeam || !awayTeam || !detailUrl) {
                continue
            }

            const matchDetails = await fetchMatchDetails(detailUrl)
            if (!matchDetails.dateStr) {
                continue
            }

            const date = parseGameDate(matchDetails.dateStr)
            games.push({
                homeTeam: mapClubName(homeTeam),
                awayTeam: mapClubName(awayTeam),
                homeScore: matchDetails.homeScore,
                awayScore: matchDetails.awayScore,
                finished: matchDetails.finished,
                date: date.toISOString()
            })
        }
    }

    console.log(`Extracted ${games.length} games from edition ${edition}`)

    return games
}

const emptyMatchDetails = () => ({
    finished: false,
    homeScore: null,
    awayScore: null,
    dateStr: null,
})

const fetchMatchDetails = async (url) => {
    // If url does not start with http, prepend base url
    if (!url.startsWith('http')) {
        url = AFPB_BASE_URL + url
    }

    let response = {}

    try {
        console.log(`Fetching match details from ${url}`)
        response = await axios.get(url, {
            headers: generateRandomHeaders(),
            timeout: 10000,
            withCredentials: true
        })

        if (response.status !== 200) {
            console.log(`Error fetching match details from ${url}, status: ${response.status}`)
            return emptyMatchDetails()
        }
    } catch (error) {
        console.log(`Error fetching match details from ${url}: ${error.message}`)
        return emptyMatchDetails()
    }

    const $ = cheerio.load(response.data)
    const matchStatusText = $(CSS_SELECTORS.MATCH_STATUS).text().trim().toLowerCase()
    const finished = matchStatusText.includes('terminado')
    const inPlay = matchStatusText.includes('decorrer')

    let homeScore = null
    let awayScore = null
    // A match that has not started still renders "0 - 0".
    if (finished || inPlay) {
        const scoreText = $(CSS_SELECTORS.MATCH_SCORE).first().text().trim()
        const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/)
        if (scoreMatch) {
            homeScore = parseInt(scoreMatch[1], 10)
            awayScore = parseInt(scoreMatch[2], 10)
        }
    }

    return {
        finished,
        homeScore,
        awayScore,
        dateStr: $(CSS_SELECTORS.MATCH_DATE).first().text().trim() || null,
    }
}

const parseGameDate = (dateStr) => {
    // AFPB lists use "DD/MM HH:MM". Match pages use "DD/MM/YYYY HH:MM". Time is Europe/Lisbon, stored as a local Date.
    const splitted = dateStr.split(' ').filter(Boolean)
    const dateParts = splitted[0].split('/').map(x => parseInt(x, 10))
    const [hour, minute] = splitted[1].split(':').map(x => parseInt(x, 10))
    const year = dateParts[2] || new Date().getFullYear()
    return new Date(year, dateParts[1] - 1, dateParts[0], hour, minute)
}

const mapClubName = (name) => {
    if (!config.club_names_map) {
        console.warn('No club names map found in config')
        return name
    }

    const map = config.club_names_map
    const length = map.length
    for (let i = 0; i < length; i++) {
        if (map[i].from === name) {
            return map[i].to
        }
    }

    console.warn(`No mapping found for club ${name}`)

    return name
}

const generateRandomHeaders = () => {
    // Random User Agents
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]

    // Random Accept-Language combinations
    const languages = [
        'pt-PT,pt;q=0.9,en;q=0.8',
        'pt-BR,pt;q=0.9,en;q=0.8',
        'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'en-US,en;q=0.9,pt;q=0.8',
        'en-GB,en;q=0.9,pt;q=0.8'
    ]

    // Random Accept headers
    const accepts = [
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    ]

    // Generate random cookie values
    const generateRandomId = () => Math.floor(Math.random() * 1000000000) + 1000000000
    const generateRandomTimestamp = () => Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 30) // Random time in last 30 days

    const gaId = generateRandomId()
    const gidId = generateRandomId()
    const fbpId = generateRandomTimestamp()
    const gaTimestamp = generateRandomTimestamp()
    const gidTimestamp = generateRandomTimestamp()

    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': accepts[Math.floor(Math.random() * accepts.length)],
        'Accept-Language': languages[Math.floor(Math.random() * languages.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': Math.random() > 0.5 ? '1' : '0', // Randomly include DNT
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': Math.random() > 0.3 ? 'max-age=0' : 'no-cache', // Sometimes vary cache control
        'Cookie': `_ga=GA1.2.${gaId}.${gaTimestamp}; _gid=GA1.2.${gidId}.${gidTimestamp}; _fbp=fb.1.${fbpId}.${gaTimestamp}`
    }
}

module.exports = {
    handleGroup
}
