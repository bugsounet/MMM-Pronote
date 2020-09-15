const pronote = require('pronote-api');
const NodeHelper = require("node_helper");

let log = (...args) => { /* do nothing */ }

module.exports = NodeHelper.create({
   start: function() {
    /** initialize all value there **/
    this.session = null
    this.data = {}
  },

  initialize: async function(config) {
    console.log("[PRONOTE] MMM-Pronote Version:", require('./package.json').version)
    this.config = config
    if (this.config.debug) log = (...args) => { console.log("[PRONOTE]", ...args) }
    this.interval = null
    this.updateIntervalMilliseconds = this.getUpdateIntervalMillisecondFromString(this.config.updateInterval)

    this.session = await this.login()
    this.session.setKeepAlive(true)

    await this.fetchData()
    this.sendSocketNotification("INITIALIZED")
    console.log("[PRONOTE] Pronote is initialized.")
  },

  /** Login to Pronote **/
  login: async function() {
    try {
      return await pronote.login(
        this.config.url,
        this.config.username,
        this.config.password,
        this.config.cas,
        this.config.account
      )
    } catch (err) {
      if (err.code === pronote.errors.WRONG_CREDENTIALS.code) {
        this.sendSocketNotification('INVALID_CREDENTIALS')
      } else {
        console.error(err)
      }
    }
  },

  fetchData: async function() {
    /** create or update data object **/
    this.data["name"] = this.session.user.name
    this.data["class"] = this.session.user.studentClass.name
    this.data["establishmentsInfo"] = this.session.user.establishmentsInfo
    this.data["holidays"] = this.session.params.publicHolidays
    //this.data["USER"] = this.session.user
    //this.data["PARAMS"] = this.session.params
    const filledDaysAndWeeks = await pronote.fetchTimetableDaysAndWeeks(this.session)
    const timetableDay = this.getNextDayOfClass(filledDaysAndWeeks.filledDays)
    const timetableOfNextDay = await this.getTimetable(this.session, timetableDay)

    let fromNow = new Date()
    let from = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),fromNow.getHours(),0,0) // garde l'heure de cours actuelle
    let to = new Date(fromNow.getFullYear(),fromNow.getMonth(),fromNow.getDate(),18,0,0) // fin des cours a 18h
    const timetableOfTheDay = await this.session.timetable(from,to)

    const marks = await this.session.marks()
    const contents = await this.session.contents()
    const evaluations = await this.session.evaluations()
    const absences = await this.session.absences()
    const infos = await this.session.infos()
    const menu = await this.session.menu()
    const homeworks= await this.session.homeworks() // ? new api ?

    this.data["timetableOfTheDay"] = timetableOfTheDay // test de recup emploi du temps du jour (@bugsounet version)
    this.data["timetableOfNextDay"] = { timetable: timetableOfNextDay, timetableDay: timetableDay } // ta version pour comparer
    this.data["marks"] = marks // notes de l'eleve
    this.data["contents"] = contents // je sais pas trop pour le moment c'est vide ... (peut-etre les actus ?)
    this.data["evaluations"] = evaluations // les resulat des evals
    this.data["absences"] = absences // les absences ..
    this.data["infos"] = infos // info Prof/Etablisement -> eleves ?
    this.data["menu"] = menu // le menu de la cantine
    this.data["homeworks"] = homeworks // liste des devoirs à faire

    /** convert Dates en HH:MM **/
    Array.from(this.data.timetableOfTheDay, course => {
      course.fromHour = new Date(course.from).toLocaleTimeString(this.config.language, {hour: '2-digit', minute:'2-digit'})
      course.toHour = new Date(course.to).toLocaleTimeString(this.config.language, {hour: '2-digit', minute:'2-digit'})
    })

    /** don't display if it's not today **/
    if (this.data.timetableOfTheDay.length > 0) {
      let wanted = this.data.timetableOfTheDay[0].to.toLocaleDateString(this.config.language, { day: 'numeric' })
      let now = new Date().toLocaleDateString(this.config.language, { day: 'numeric' })
      if (wanted != now) this.data["timetableOfTheDay"] = []
    }

    Array.from(this.data.timetableOfNextDay.timetable, (course) => {
      course.localizedFrom = (new Date(course.from)).toLocaleTimeString(this.config.language, {hour: '2-digit', minute:'2-digit'})
      course.localizedTo = (new Date(course.to)).toLocaleTimeString(this.config.language, {hour: '2-digit', minute:'2-digit'})
    })
    var parseTimetableDay = new Date(this.data.timetableOfNextDay.timetableDay)
    var localizedTimetableDay = parseTimetableDay.toLocaleDateString(this.config.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    this.data.timetableOfNextDay["localizedTimetableDay"] = localizedTimetableDay

    /** send all datas ... **/
    this.sendSocketNotification("PRONOTE_UPDATED", this.data)
    //log("Data:", this.data) // log as you want ;)

    /** Ok ! All info are sended auto-update it ! **/
    this.scheduleUpdate()
  },

  getTimetable: async function(session, date = null) {
    return await session.timetable(date)
  },

  getDayOfYear: function() {
    let now = new Date()
    let start = new Date(now.getFullYear(), 0, 0)
    let diff = now - start
    let oneDay = 1000 * 60 * 60 * 24

    return Math.floor(diff / oneDay)
  },

  getNextDayOfClass: function(filledDays) {
    const currentDay = this.getDayOfYear()
    let nextDayOfClassNumber = currentDay
    for (let i = 0; i < filledDays.length; i++) {
      if (filledDays[i] > currentDay) {
        nextDayOfClassNumber = filledDays[i]
        break
      }
    }

    let firstDayOfYear = new Date((new Date()).getFullYear(), 0)

    return new Date(firstDayOfYear.setDate(nextDayOfClassNumber))
  },

  socketNotificationReceived: function(notification, payload) {
    switch(notification) {
      case 'SET_CONFIG':
        this.initialize(payload)
        break
    }
  },

  /** update process **/
  scheduleUpdate: function(delay) {
   let nextLoad = this.updateIntervalMilliseconds
   if (typeof delay !== "undefined" && delay >= 0) {
     nextLoad = delay
   }
   clearInterval(this.interval)
   this.interval = setInterval(() => {
     this.fetchData()
     log("Pronote datas are updated.")
   }, nextLoad)
  },

  /** convert h m s to ms (good idea !) **/
  getUpdateIntervalMillisecondFromString: function(intervalString) {
   let regexString = new RegExp("^\\d+[smhd]{1}$")
   let updateIntervalMillisecond = 0

   if (regexString.test(intervalString)){
     let regexInteger = "^\\d+"
     let integer = intervalString.match(regexInteger)
     let regexLetter = "[smhd]{1}$"
     let letter = intervalString.match(regexLetter)

     let millisecondsMultiplier = 1000
      switch (String(letter)) {
        case "s":
          millisecondsMultiplier = 1000
          break
        case "m":
          millisecondsMultiplier = 1000 * 60
          break
        case "h":
          millisecondsMultiplier = 1000 * 60 * 60
          break
        case "d":
          millisecondsMultiplier = 1000 * 60 * 60 * 24
          break
      }
      // convert the string into seconds
      updateIntervalMillisecond = millisecondsMultiplier * integer
    } else {
      updateIntervalMillisecond = 1000 * 60 * 60 * 24
    }
    return updateIntervalMillisecond
  },

});
