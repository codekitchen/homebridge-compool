const Controller = require('compool-controller');

let Service, Characteristic;

class CompoolController {
    constructor(log, config) {
        log("Initializing CompoolController");
        this.log = log;
        this.config = config;
        this.name = this.config.name;
        this.lastStatus = null;

        if (!this.config.devicePath) {
            throw new Error(`A devicePath value is required for plugin ${this.name}`);
        }

        this.controller = new Controller(this.config.devicePath);
        this.controller.on('status', status => this.onStatus(status));
        this.controller.on('error', err => this.onControllerError(err));
    }

    getServices() {
        let accessoryInfo = new Service.AccessoryInformation();
        accessoryInfo
            .setCharacteristic(Characteristic.Manufacturer, "Compool")
            .setCharacteristic(Characteristic.Model, "cp3800")
            .setCharacteristic(Characteristic.Name, this.name);

        let airTemp = new Service.TemperatureSensor("Air Temperature");
        airTemp
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', cb => {
                cb(null, Number(this.getStatus('airTemp')));
            });

		return [accessoryInfo, airTemp];
    }

    getStatus(field) {
        if (!this.lastStatus) return null;
        return this.lastStatus[field];
    }

    onStatus(status) {
        this.lastStatus = status;
        this.log(status);
    }

    onControllerError(err) {
        this.log("Got error!", err);
    }
}

module.exports = homebridge => {
	({ Service, Characteristic } = homebridge.hap);
	homebridge.registerAccessory('homebridge-compool', 'CompoolController', CompoolController);
};
