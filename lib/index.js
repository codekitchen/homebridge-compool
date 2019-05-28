const Controller = require('compool-controller');

let Service, Characteristic;

class CompoolController {
    constructor(log, config) {
        log("Initializing CompoolController");
        this.log = log;
        this.config = config;
        this.name = this.config.name;
        this.lastStatus = null;
		this.accessories = [];

        if (!this.config.devicePath) {
            throw new Error(`A devicePath value is required for plugin ${this.name}`);
        }
    }

    getServices() {
        let accessoryInfo = new Service.AccessoryInformation();
        accessoryInfo
            .setCharacteristic(Characteristic.Manufacturer, "Compool")
            .setCharacteristic(Characteristic.Model, "cp3800")
            .setCharacteristic(Characteristic.Name, this.name);
		this.accessories.push(accessoryInfo);

		this.poolTemp = new Service.Thermostat("Pool Heat", "pool");
		this.poolTemp.getCharacteristic(Characteristic.TargetTemperature)
			.on('set', (value, cb) => this.controller.setPoolTemp(value, cb));
		this.poolTemp.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('set', (value, cb) => this.controller.setPoolHeater(value, cb));
		this.accessories.push(this.poolTemp);
		this.spaTemp = new Service.Thermostat("Spa Heat", "spa");
		this.spaTemp.getCharacteristic(Characteristic.TargetTemperature)
			.on('set', (value, cb) => this.controller.setSpaTemp(value, cb));
		this.spaTemp.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('set', (value, cb) => this.controller.setSpaHeater(value, cb));
		this.accessories.push(this.spaTemp);

        this.airTemp = new Service.TemperatureSensor("Air Temperature");
        this.airTemp
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', cb => {
                cb(null, this.getStatus('airTemp'));
            });
		this.accessories.push(this.airTemp);

		this.auxs = {};
		for (let i = 1; i <= 8; ++i) {
			let name = this.config[`aux${i}`];
			if (name) {
				let aux = new Service.Switch(name, `aux${i}`);
				this.auxs[`aux${i}On`] = aux;
				aux
					.getCharacteristic(Characteristic.On)
					.on('get', cb => cb(null, this.getStatus(`aux${i}On`)) )
					.on('set', (value, cb) => this.controller.toggleAux(i, cb) );
				this.accessories.push(aux);
			}
		}

        this.controller = new Controller(this.config.devicePath);
        this.controller.on('status', status => this.onStatus(status));
        this.controller.on('error', err => this.onControllerError(err));

		return this.accessories;
    }

	refreshAll() {
		if (!this.lastStatus) return;
		this.poolTemp.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.getStatus('poolHeaterOn') ? 1 : 0);
		this.poolTemp.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.getStatus('poolHeaterOn') ? 1 : 0);
		this.poolTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('poolWaterTemp'));
		this.poolTemp.updateCharacteristic(Characteristic.TargetTemperature, this.getStatus('desiredPoolWaterTemp'));
		this.spaTemp.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.getStatus('spaHeaterOn') ? 1 : 0);
		this.spaTemp.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.getStatus('spaHeaterOn') ? 1 : 0);
		this.spaTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('spaWaterTemp'));
		this.spaTemp.updateCharacteristic(Characteristic.TargetTemperature, this.getStatus('desiredSpaWaterTemp'));

		this.airTemp.updateCharacteristic(Characteristic.CurrentTemperature, this.getStatus('airTemp'));
		for (let field in this.auxs) {
			let value = this.getStatus(field);
			this.auxs[field].updateCharacteristic(Characteristic.On, value);
		}
	}

    getStatus(field) {
        if (!this.lastStatus) return null;
        return this.lastStatus[field];
    }

    onStatus(status) {
        this.lastStatus = status;
        this.log(status);
		this.refreshAll();
    }

    onControllerError(err) {
        this.log("Got error!", err);
    }
}

module.exports = homebridge => {
	({ Service, Characteristic } = homebridge.hap);
	homebridge.registerAccessory('homebridge-compool', 'CompoolController', CompoolController);
};
