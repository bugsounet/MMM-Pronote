/* Magic Mirror
 * Module: MMM-Pronote
 *
 * By Julien "delphiki" Villetorte
 * and @bugsounet
 * MIT Licensed.
 */

Module.register("MMM-Pronote", {

  requiresVersion: "2.13.0",
  defaults: {
    debug: false, // set it to false if you want no debug in console
    defaultAccount: 1,
    Accounts: [
      {
        url: null,
        username: null,
        password: null,
        cas: 'none',
        account: 'parent',
        studentNumber: 1, // only for parent account
      }
    ],
    rotateAccount: true,
    rotateInterval: "1m",
    updateInterval: "15m",
    PeriodType: "semester",
    Header: {
      displayEstablishmentName: true,
      displayStudentName: true,
      displayStudentClass: true,
      displayAvatar: true
    },
    Timetables: {
      displayActual: true,
      displayNextDay: true,
      displayTeacher: true,
      displayRoom: true
    },
    Averages: {
      display : true,
      displayStudent: true,
      displayClass: true
    },
    Marks: {
      display: true,
      searchDays: 7,
      displayAverage: true,
      displayCoeff: true
    },
    Homeworks: {
      display: true,
      searchDays: 7,
      numberDays: 1,
      displayDescription: true,
      displayDone: true
    },
    Absences: {
      display: true,
      searchDays: 7,
      number: 1
    },
    Delays: {
      display: true,
      searchDays: 7,
      number: 1
    },
    Holidays: {
      display: true,
      number: 3
    },
    NPMCheck: {
      useChecker: true,
      delay: "45m",
      useAlert: true
    }
  },

  start: function() {
   this.config = configMerge({}, this.defaults, this.config)
   this.userData = {}
   this.init = false
   this.error = null
   if (this.config.debug) this.log = (...args) => { console.log("[PRONOTE]", ...args) }
   else this.log = (...args) => { /* do nothing */ }
  },

  getStyles: function() {
    return ["pronote.css"]
  },

  getTemplate: function () {
    if (!this.init) {
      return "templates/loading.njk"
    } else if(Object.keys(this.userData).length === 0) {
      return "templates/error.njk"
    } else {
      return "templates/layout.njk"
    }
  },

  getTemplateData: function () {
    if (!this.init) {
      return {
        loading: this.translate("LOADING")
      }
    } else if (this.error) {
      console.log("[PRONOTE] Error:", this.error)
      return {
        error: this.error
      }
    } else {
      return {
        config: this.config,
        userData: this.userData,
      }
    }
  },

  updateData: function(data) {
    this.userData = data
    if (Object.keys(this.userData).length === 0) {
      this.log ("Error... no data!")
      this.error = "Erreur... Aucune données"
      return
    }
    this.log("data:", this.userData)
    if (this.init) this.updateDom(500)
  },

  notificationReceived: function(notification, payload, sender) {
    switch (notification) {
      case "ALL_MODULES_STARTED":
        if (!this.config.language) this.config.language = config.language
        this.sendSocketNotification('SET_CONFIG', this.config)
        break
      case "PRONOTE_ACCOUNT":
        if (!isNaN(payload)) {
          this.sendSocketNotification("SET_ACCOUNT", payload)
        }
        else console.error("[PRONOTE] Account not a number", payload)
        break
    }
  },

  socketNotificationReceived: function(notification, payload) {
    switch (notification) {
      case "PRONOTE_UPDATED":
        if (payload) {
          this.error = null
          this.updateData(payload)
          this.sendNotification("PRONOTE_DATA", payload)
        }
        else {
          this.userData = {}
          this.error = "Erreur... Aucune données"
          this.updateDom()
        }
        break
      case "INITIALIZED":
          this.init = true
          if (!this.error) this.updateDom(500)
        break
      case "ERROR":
        this.init = true
        this.userData = {}
        this.error = payload
        this.updateDom()
        break
      case "NPM_UPDATE":
        if (payload && payload.length > 0) {
          if (this.config.NPMCheck.useAlert) {
            payload.forEach(npm => {
              this.sendNotification("SHOW_ALERT", {
                type: "notification" ,
                message: "[NPM] " + npm.library + " v" + npm.installed +" -> v" + npm.latest,
                title: this.translate("UPDATE_NOTIFICATION_MODULE", { MODULE_NAME: npm.module }),
                timer: this.getUpdateIntervalMillisecondFromString(this.config.NPMCheck.delay) - 2000
              })
            })
          }
          this.sendNotification("NPM_UPDATE", payload)
        }
        break
    }
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

  /** TelegramBot pronote command **/
  getCommands: function(commander) {
    commander.add({
      command: "pronote",
      description: "Change le compte de pronote",
      callback: "pronote"
    })
  },

  pronote: function(command,handler) {
    if (handler.args) {
      var args = handler.args.split(" ")
      if (!isNaN(args[0])) {
          if (args[0] == 0 || (args[0] > this.config.Accounts.length)) return handler.reply("TEXT", "Compte non trouvé: " + args[0])
          handler.reply("TEXT", "Je change le compte pronote vers le numéro " + args[0])
          this.sendSocketNotification("SET_ACCOUNT", args[0])
      }
      else handler.reply("TEXT", args[0] + " n'est pas un numéro du compte valide")
    }
    else handler.reply("TEXT", "Merci de spécifier le numéro du compte")
  }
});
