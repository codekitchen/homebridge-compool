const Controller = require('compool-controller');

const Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("compool-controller", "CompoolController", CompoolController);
};

class CompoolController {
    constructor(log, config, api) {
        log("Initializing CompoolController");
        this.log = log;
        if (!config) return;
        this.config = config;
        this.api = api;
        this.name = this.config.name;
        this.lastStatus = null;
        this.accessories = [];

        if (!this.config.devicePath) {
            throw new Error(`A devicePath value is required for plugin ${this.name}`);
        }

        this.controller = new Controller(config.devicePath);
        this.controller.on('status', status => this.onStatus(status));
        this.controller.on('error', err => this.onControllerError(err));

        this.api.on('didFinishLaunching', () => this.setup());
    }

    setup() {
        if (this.accessories.length == 0) {
            let uuid = UUIDGen.generate('airTemp');
            let airTemp = new Accessory('airTemp', uuid);
            airTemp.addService(Service.TemperatureSensor, "Air Temperature");
            this.configureAccessory(airTemp);
            this.api.registerPlatformAccessories("compool-controller", "CompoolController", [airTemp]);
        }
    }

    setupAccessoryInfo() {
        let accessoryInfo = new Service.AccessoryInformation();
        accessoryInfo
            .setCharacteristic(Characteristic.Manufacturer, "Compool")
            .setCharacteristic(Characteristic.Model, "cp3800")
            .setCharacteristic(Characteristic.Name, this.name);
        return accessoryInfo;
    }

    configureAccessory(accessory) {
        this.log(accessory.displayName, "configureAccessory");
        accessory.reachable = true;
        accessory.on('identify', (paired, cb) => {
            this.log(accessory.displayName, "identify");
            cb();
        });
        // hax
        let airTemp = accessory;
        let service = airTemp.getService(Service.TemperatureSensor);
        service.setCharacteristic(Characteristic.CurrentTemperature, 0.0);
        service.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', (cb) => {
                if (this.lastStatus)
                    cb(this.lastStatus.airTemp);
                else
                    cb(0.0);
            });

        this.accessories.push(accessory);
    }

    onStatus(status) {
        this.lastStatus = status;
    }

    onControllerError(err) {
        this.log("Got error!", err);
    }
}